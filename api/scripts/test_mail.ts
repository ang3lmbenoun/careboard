import "dotenv/config";
import fs from "node:fs";
import pg from "pg";
import { withRole } from "../src/db.js";
import { emailAction, renderFollowup } from "../src/followupMail.js";
import type { Sender } from "../src/digest.js";

// Tests the follow-up email: only after approval, only once, allow list, kill switch, numbers from the database,
// no names, HTML escaped. The provider is replaced by a stand-in; nothing is sent. Usage (api folder): npx tsx scripts/test_mail.ts
let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, extra = "") => { cond ? pass++ : fail++; console.log(`${cond ? "PASS" : "FAIL"} ${name}${cond ? "" : "  " + extra}`); };
const db = new pg.Pool({ connectionString: process.env.ADMIN_DATABASE_URL });
const { rows: users } = await db.query("SELECT id, role, clinic_id FROM app.users ORDER BY id");
const claims = (role: string, clinic?: number) => { const r = users.find((x: any) => x.role === role && (clinic == null || x.clinic_id === clinic)); return { sub: r.id as number, role: role as any, clinicId: r.clinic_id as number | null }; };
const clin = claims("clinician");
await db.query("DELETE FROM app.digest_recipients");
await db.query("INSERT INTO app.digest_recipients (email) VALUES ('good@example.test')");
await db.query("UPDATE app.agent_settings SET value='true' WHERE key='agents_enabled'");
const fake = (): { sender: Sender; sent: any[] } => { const sent: any[] = []; return { sent, sender: async (m) => { sent.push(m); return { ok: true, status: 200 }; } }; };
const ids: number[] = await withRole(clin, async (c) => (await c.query("SELECT patient_id FROM clinical.care_risk ORDER BY points DESC, patient_id LIMIT 3")).rows.map((r: any) => r.patient_id));
const other: number[] = (await db.query("SELECT patient_id FROM clinical.patients WHERE clinic_id <> $1 LIMIT 2", [clin.clinicId])).rows.map((r: any) => r.patient_id);
const mkAction = async (type: string, pids: number[], status = "pending") => {
  const run = (await db.query("INSERT INTO app.agent_runs (user_id, role, clinic_id, question) VALUES ($1,'clinician',$2,'test') RETURNING id", [clin.sub, clin.clinicId])).rows[0].id;
  return (await db.query("INSERT INTO app.agent_actions (run_id,user_id,clinic_id,tier,type,payload,status) VALUES ($1,$2,$3,2,$4,$5,$6) RETURNING id", [run, clin.sub, clin.clinicId, type, { patient_ids: pids, reason: 'Rising <b>A1C</b> & "overdue"' }, status])).rows[0].id as number;
};
fs.rmSync("outbox", { recursive: true, force: true });

// 1. pending actions are never emailed
let f = fake(); const a0 = await mkAction("email_followup_list", ids);
let r = await emailAction(clin, a0, { sender: f.sender });
ok("a pending draft is not emailed", r.status === "blocked" && f.sent.length === 0, JSON.stringify(r));

// 2. approved: sent once, HTML, numbers from the database
await db.query("UPDATE app.agent_actions SET status='approved' WHERE id=$1", [a0]);
r = await emailAction(clin, a0, { sender: f.sender });
ok("an approved draft is sent", r.status === "sent" && f.sent.length === 1, JSON.stringify(r));
const m = f.sent[0];
ok("the email has an HTML part and a text part", !!m?.html?.includes("<table") && !!m?.text);
ok("it lists the patient numbers", ids.every((i) => m.html.includes("#" + i) && m.text.includes("#" + i)));
ok("model text is HTML-escaped", m.html.includes("&lt;b&gt;A1C&lt;/b&gt;") && !m.html.includes("<b>A1C</b>"));
ok("it goes only to the allow-listed address", m.to === "good@example.test");
const names = (await db.query("SELECT full_name FROM clinical.patients WHERE patient_id = ANY($1)", [ids])).rows.map((x: any) => x.full_name as string);
ok("no patient name appears", names.every((n) => !m.html.includes(n) && !m.text.includes(n)));
const again = await emailAction(clin, a0, { sender: f.sender });
ok("the same action is not emailed twice", again.status === "skipped" && f.sent.length === 1);
const out = (await db.query("SELECT outcome FROM app.agent_actions WHERE id=$1", [a0])).rows[0].outcome;
ok("the action records what happened", String(out).startsWith("emailed"));
const lg = (await db.query("SELECT status, kind, content_sha256 FROM app.digest_log WHERE kind='followup' ORDER BY id DESC LIMIT 1")).rows[0];
ok("the send is logged with a hash", lg?.status === "sent" && lg.content_sha256?.length === 64);

// 3. a call list approved without email can be emailed afterwards
f = fake(); const a1 = await mkAction("followup_call_list", ids, "approved");
r = await emailAction(clin, a1, { sender: f.sender });
ok("an approved call list can be emailed on request", r.status === "sent");

// 4. patients outside the user's clinic never appear
f = fake(); const a2 = await mkAction("email_followup_list", [...ids.slice(0, 1), ...other], "approved");
r = await emailAction(clin, a2, { sender: f.sender });
ok("another clinic's patients are not in the email", r.status === "sent" && other.every((o) => !f.sent[0].text.includes("#" + o + " ")) && f.sent[0].text.includes("#" + ids[0]));
f = fake(); const a3 = await mkAction("email_followup_list", other, "approved");
r = await emailAction(clin, a3, { sender: f.sender });
ok("a list of only other-clinic patients sends nothing", r.status === "blocked" && f.sent.length === 0);

// 5. kill switch and allow list
f = fake(); const a4 = await mkAction("email_followup_list", ids, "approved");
await db.query("UPDATE app.agent_settings SET value='false' WHERE key='agents_enabled'");
r = await emailAction(clin, a4, { sender: f.sender });
ok("the kill switch blocks sending", r.status === "blocked" && f.sent.length === 0);
await db.query("UPDATE app.agent_settings SET value='true' WHERE key='agents_enabled'");
await db.query("DELETE FROM app.digest_recipients");
r = await emailAction(clin, a4, { sender: f.sender });
ok("an empty allow list blocks sending", r.status === "blocked" && f.sent.length === 0);
await db.query("INSERT INTO app.digest_recipients (email) VALUES ('good@example.test')");

// 6. provider failure and dry run
const bad: Sender = async () => ({ ok: false, status: 500 });
r = await emailAction(clin, a4, { sender: bad });
ok("a provider failure is reported, not hidden", r.status === "error");
const keep = process.env.RESEND_API_KEY; delete process.env.RESEND_API_KEY;
const a5 = await mkAction("email_followup_list", ids, "approved");
r = await emailAction(clin, a5);
ok("without a provider key the email is saved to the outbox", r.status === "dry_run" && fs.existsSync("outbox") && fs.readdirSync("outbox").some((x) => x.endsWith(".html")));
if (keep) process.env.RESEND_API_KEY = keep;

// 7. other users' actions
const exec = claims("executive");
r = await emailAction(exec, a5);
ok("another user cannot email someone else's action", r.status === "blocked");
const t = renderFollowup({ reason: "x", rows: [], link: "https://x.test", date: "2026-01-01", sender: "s" });
ok("the template renders with no rows", t.html.includes("</html>"));

await db.end();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
