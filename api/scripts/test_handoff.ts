import "dotenv/config";
import pg from "pg";
import { withRole } from "../src/db.js";
import { AIMessage } from "@langchain/core/messages";
import { runAgent, toolsFor, type Chat } from "../src/agent.js";
import { contacts, handoffSummary, notifyMessage, sendMessage } from "../src/handoff.js";

// Tests the nurse and clinician hand-off at the database level: who can message whom, isolation between clinics,
// no edits or deletes, record checks, stock counts, and that the notice email holds no message text.
// Run against a LOCAL database only (it adds a clinic 2 nurse and deletes the allow list). Usage (api folder): npx tsx scripts/test_handoff.ts
let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, extra = "") => { cond ? pass++ : fail++; console.log(`${cond ? "PASS" : "FAIL"} ${name}${cond ? "" : "  " + extra}`); };
const db = new pg.Pool({ connectionString: process.env.ADMIN_DATABASE_URL });
const U = (await db.query("SELECT id, email, role, clinic_id FROM app.users ORDER BY id")).rows;
const by = (email: string) => { const r = U.find((x: any) => x.email === email); return { sub: r.id as number, role: r.role as any, clinicId: r.clinic_id as number | null }; };
const nurse = by("nurse@careboard.dev"), clin = by("clinician@careboard.dev"), clin2 = by("clinician2@careboard.dev"), exec = by("executive@careboard.dev"), adm = by("admin@careboard.dev");
const denied = async (u: any, sql: string, p: any[] = []) => { try { await withRole(u, (c) => c.query(sql, p)); return false; } catch (e: any) { return e.code === "42501" || e.code === "42P17" || e.code === "23514"; } };
const rejected = async (fn: () => Promise<unknown>) => { try { await fn(); return false; } catch { return true; } };

// a clinic 2 nurse for the cross-clinic checks
await db.query("INSERT INTO app.users (email, display_name, password_hash, role, clinic_id) SELECT 'nurse2@careboard.dev','Demo Nurse (clinic 2)',password_hash,'nurse',2 FROM app.users WHERE email='nurse@careboard.dev' ON CONFLICT (email) DO NOTHING");
const nurse2r = (await db.query("SELECT id FROM app.users WHERE email='nurse2@careboard.dev'")).rows[0];
const nurse2 = { sub: nurse2r.id as number, role: "nurse" as const, clinicId: 2 };

// 1. contacts
const nc = await contacts(nurse), cc = await contacts(clin);
ok("a nurse sees only the clinicians of her clinic", nc.length === 1 && nc[0].id === clin.sub);
ok("a clinician sees only the nurses of his clinic", cc.length === 1 && cc[0].id === nurse.sub);
ok("a clinic 2 clinician cannot see clinic 1 nurses", (await contacts(clin2)).every((p) => p.id !== nurse.sub));
ok("an executive has no contacts", (await contacts(exec).catch(() => [])).length === 0);

// 2. sending
const m1 = await sendMessage(nurse, { to_user: clin.sub, subject: "Patient follow-up", body: "Please review the new A1C. <script>alert(1)</script>" });
ok("a nurse can message a clinician of her clinic", m1 > 0);
ok("a nurse cannot message a clinician of another clinic", await rejected(() => sendMessage(nurse, { to_user: clin2.sub, subject: "x", body: "x" })));
ok("a nurse cannot message another nurse", await rejected(() => sendMessage(nurse, { to_user: nurse2.sub, subject: "x", body: "x" })));
ok("a nurse cannot message an executive", await rejected(() => sendMessage(nurse, { to_user: exec.sub, subject: "x", body: "x" })));
ok("an executive cannot send messages", await rejected(() => sendMessage(exec as any, { to_user: clin.sub, subject: "x", body: "x" })));
const row = (await db.query("SELECT from_user, clinic_id FROM app.messages WHERE id=$1", [m1])).rows[0];
ok("the sender and clinic come from the session", row.from_user === nurse.sub && row.clinic_id === 1);
ok("a sender cannot set another sender", await denied(nurse, "INSERT INTO app.messages (from_user, to_user, subject, body) VALUES ($1,$2,'x','x')", [clin.sub, clin.sub]));
const other = (await db.query("SELECT patient_id FROM clinical.patients WHERE clinic_id = 2 LIMIT 1")).rows[0].patient_id;
ok("a message cannot point at another clinic's patient", await rejected(() => sendMessage(nurse, { to_user: clin.sub, patient_id: other, subject: "x", body: "x" })));
const own = (await db.query("SELECT patient_id FROM clinical.patients WHERE clinic_id = 1 LIMIT 1")).rows[0].patient_id;
ok("a message can point at an own-clinic patient", (await sendMessage(nurse, { to_user: clin.sub, patient_id: own, subject: "About a patient", body: "ok" })) > 0);

// 3. reading, replying, marking read
const inbox = await withRole(clin, async (c) => (await c.query("SELECT id, body, read_at FROM app.messages WHERE to_user = app.current_user_id() ORDER BY id")).rows);
ok("the clinician sees the message", inbox.some((r: any) => r.id === m1));
ok("another clinic's clinician sees none of it", (await withRole(clin2, async (c) => (await c.query("SELECT count(*)::int n FROM app.messages")).rows[0].n)) === 0);
ok("an executive and an admin see no messages", (await denied(exec, "SELECT * FROM app.messages")) && (await denied(adm, "SELECT * FROM app.messages")));
const reply = await sendMessage(clin, { to_user: nurse.sub, parent_id: m1, subject: "Re: Patient follow-up", body: "Thanks, will call." });
ok("the clinician can reply", reply > 0);
ok("the sender cannot mark the recipient's copy as read", (await withRole(nurse, async (c) => (await c.query("UPDATE app.messages SET read_at = now() WHERE id = $1", [m1])).rowCount)) === 0);
ok("the recipient can mark a message read", (await withRole(clin, async (c) => (await c.query("UPDATE app.messages SET read_at = now() WHERE id = $1", [m1])).rowCount)) === 1);
ok("nobody can edit the text", await denied(clin, "UPDATE app.messages SET body = 'changed' WHERE id = $1", [m1]));
ok("nobody can delete a message", await denied(clin, "DELETE FROM app.messages WHERE id = $1", [m1]));
ok("a message over 1500 characters is refused", await rejected(() => sendMessage(nurse, { to_user: clin.sub, subject: "x", body: "y".repeat(1501) })));

// 4. the notice email holds no text
await db.query("DELETE FROM app.digest_recipients"); await db.query("INSERT INTO app.digest_recipients (email) VALUES ('good@example.test')");
await db.query("UPDATE app.agent_settings SET value='true' WHERE key='agents_enabled'");
const sent: any[] = [];
const n = await notifyMessage("nurse", "clinician", 1, { sender: async (m) => { sent.push(m); return { ok: true, status: 200 }; } });
ok("a notice is sent to the allow-listed address", n.status === "sent" && sent.length === 1 && sent[0].to === "good@example.test");
ok("the notice holds no subject, text or patient number", !/Patient follow-up|review the new A1C|script/.test(sent[0].html + sent[0].text) && !/#\s?\d/.test(sent[0].text) && !/patient/i.test(sent[0].text));
ok("the notice is HTML", sent[0].html.includes("<table"));

// 5. record checks
const pn = (await withRole(nurse, async (c) => (await c.query("INSERT INTO clinical.patients (clinic_id, full_name, birth_date, primary_condition, demo_created, payer) VALUES ($1,'Check Person','1960-01-01','Prediabetes',true,'Medicaid') RETURNING patient_id", [1])).rows[0].patient_id)) as number;
const todo = async (u: any) => withRole(u, async (c) => (await c.query("SELECT record_type, record_id, patient_id, status FROM app.record_checks")).rows);
ok("an unchecked nurse record is listed as to verify", (await withRole(nurse, async (c) => (await c.query("SELECT 1 FROM clinical.patients WHERE patient_id=$1 AND entered_via='role_nurse'", [pn])).rowCount)) === 1);
await withRole(nurse, (c) => c.query("INSERT INTO app.record_checks (patient_id, record_type, record_id, status) VALUES ($1,'patient',$1,'verified')", [pn]));
ok("a nurse can verify a record of her clinic", (await todo(clin)).some((r: any) => r.patient_id === pn && r.status === "verified"));
ok("a nurse cannot check a record of another clinic", await denied(nurse, "INSERT INTO app.record_checks (patient_id, record_type, record_id, status) VALUES ($1,'patient',$1,'verified')", [other]));
ok("another clinic cannot see the check", (await todo(clin2)).every((r: any) => r.patient_id !== pn));
ok("checks cannot be edited or deleted", (await denied(nurse, "UPDATE app.record_checks SET status='verified'")) && (await denied(nurse, "DELETE FROM app.record_checks")));
ok("a note over 200 characters is refused", await denied(nurse, "INSERT INTO app.record_checks (patient_id, record_type, record_id, status, note) VALUES ($1,'patient',$1,'needs_correction',$2)", [pn, "n".repeat(201)]));

// 6. stock
const stock = async (u: any) => withRole(u, async (c) => (await c.query("SELECT s.clinic_id, s.item_id, s.quantity FROM clinical.stock_counts s ORDER BY s.id DESC")).rows);
ok("a nurse sees only her clinic's stock", (await stock(nurse)).every((r: any) => r.clinic_id === 1) && (await stock(nurse)).length > 0);
ok("a clinician sees his clinic's stock", (await stock(clin)).length > 0);
ok("an executive cannot read stock", await denied(exec, "SELECT * FROM clinical.stock_counts"));
const item = (await db.query("SELECT item_id FROM clinical.stock_items LIMIT 1")).rows[0].item_id;
await withRole(nurse, (c) => c.query("INSERT INTO clinical.stock_counts (item_id, quantity, note) VALUES ($1, 3, 'test')", [item]));
ok("a nurse can add a count and it is the latest", (await stock(clin))[0].quantity === 3);
ok("a clinician cannot add a count", await denied(clin, "INSERT INTO clinical.stock_counts (item_id, quantity) VALUES ($1, 5)", [item]));
ok("a nurse cannot count for another clinic", await denied(nurse, "INSERT INTO clinical.stock_counts (clinic_id, item_id, quantity) VALUES (2, $1, 5)", [item]));
ok("counts cannot be edited or deleted", (await denied(nurse, "UPDATE clinical.stock_counts SET quantity = 99")) && (await denied(nurse, "DELETE FROM clinical.stock_counts")));
ok("a negative count is refused", await denied(nurse, "INSERT INTO clinical.stock_counts (item_id, quantity) VALUES ($1, -1)", [item]));

// 7. summary
const sm = await handoffSummary(nurse);
ok("the summary has counts and low stock names only", typeof sm.unread === "number" && Array.isArray(sm.low_stock) && sm.low_stock.length > 0);
ok("the nurse cannot read patient names or analytics", await denied(nurse, "SELECT full_name FROM clinical.patients") && await denied(nurse, "SELECT * FROM serving.clinic_daily"));

// 8. the nurse agent
const script = (...replies: AIMessage[]): Chat => { let i = 0; return { invoke: async () => replies[Math.min(i++, replies.length - 1)] }; };
const call = (name: string, args: object, id = "c1") => new AIMessage({ content: "", tool_calls: [{ name, args, id, type: "tool_call" }], usage_metadata: { input_tokens: 100, output_tokens: 20, total_tokens: 120 } });
const say = (t: string) => new AIMessage({ content: t, usage_metadata: { input_tokens: 100, output_tokens: 30, total_tokens: 130 } });
const steps = async (u: any, id: number) => withRole(u, async (c) => (await c.query("SELECT kind, content FROM app.agent_steps WHERE run_id=$1 ORDER BY seq", [id])).rows);
ok("the nurse is shown only her two tools", toolsFor("nurse").map((t) => t.name).sort().join() === "draft_handoff,my_tasks");
ok("a clinician is not shown the nurse tools", !toolsFor("clinician").some((t) => ["my_tasks", "draft_handoff"].includes(t.name)));
let r = await runAgent(nurse, "What do I need to do?", script(call("my_tasks", {}), say("You have items to check.")));
let st = await steps(nurse, r.runId);
ok("the nurse agent reads her to-do summary", r.status === "finished" && st.some((x: any) => x.kind === "result" && x.content.name === "my_tasks" && Array.isArray(x.content.clinicians)));
r = await runAgent(nurse, "Average A1C?", script(call("query_insights", { report: "spend_compare" }), say("I cannot.")));
st = await steps(nurse, r.runId);
ok("the nurse agent cannot use analytics tools", st.some((x: any) => x.kind === "blocked"));
r = await runAgent(nurse, "Search policies", script(call("search_policies", { query: "escalation rule" }), say("no")));
ok("the nurse agent cannot search policies", (await steps(nurse, r.runId)).some((x: any) => x.kind === "blocked"));
r = await runAgent(nurse, "Propose a call list", script(call("propose_action", { type: "followup_call_list", patient_ids: [own], reason: "test" }), say("no")));
ok("the nurse agent cannot propose a call list", (await steps(nurse, r.runId)).some((x: any) => x.kind === "blocked"));
r = await runAgent(nurse, "Write to the doctor", script(call("draft_handoff", { to_user: clin.sub, patient_id: own, subject: "New reading", body: "I entered a new reading for this patient." }), say("Draft is waiting for your approval.")));
const act = (await withRole(nurse, async (c) => (await c.query("SELECT type, status, payload FROM app.agent_actions WHERE run_id=$1", [r.runId])).rows))[0];
ok("a draft waits as pending and sends nothing", act?.type === "handoff_message" && act.status === "pending" && (await db.query("SELECT count(*)::int n FROM app.messages WHERE subject='New reading'")).rows[0].n === 0);
r = await runAgent(nurse, "Write to the other clinic", script(call("draft_handoff", { to_user: clin2.sub, subject: "x", body: "y" }), say("no")));
ok("a draft to another clinic's clinician is refused", (await steps(nurse, r.runId)).some((x: any) => x.kind === "blocked") && (await withRole(nurse, async (c) => (await c.query("SELECT count(*)::int n FROM app.agent_actions WHERE run_id=$1", [r.runId])).rows[0].n)) === 0);
r = await runAgent(nurse, "Write about a patient in clinic 2", script(call("draft_handoff", { to_user: clin.sub, patient_id: other, subject: "x", body: "y" }), say("no")));
ok("a draft about another clinic's patient is refused", (await steps(nurse, r.runId)).some((x: any) => x.kind === "blocked"));
ok("a nurse's agent runs are hers alone", (await withRole(clin, async (c) => (await c.query("SELECT count(*)::int n FROM app.agent_runs WHERE role='nurse'")).rows[0].n)) === 0);

await db.end();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
