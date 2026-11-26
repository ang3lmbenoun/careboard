import "dotenv/config";
import pg from "pg";
import { pool } from "../src/db.js";
import { buildReason, checkOutcomes, COOLDOWN_DAYS, MAX_PATIENTS, scanForClinician } from "../src/proactive.js";

// Tests the scheduled review (step F): who it picks, that it only drafts, the cooldown, the kill switch, clinic isolation,
// and the outcome check a week after approval. Run against a LOCAL database only: it clears the agent actions and runs of the
// two demo clinicians first, and removes what it adds. Usage (api folder): npx tsx scripts/test_proactive.ts
let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, extra = "") => { cond ? pass++ : fail++; console.log(`${cond ? "PASS" : "FAIL"} ${name}${cond ? "" : "  " + extra}`); };
if ((process.env.ADMIN_DATABASE_URL ?? "").includes("neon.tech")) throw new Error("local database only");
const db = new pg.Pool({ connectionString: process.env.ADMIN_DATABASE_URL });
const U = (await db.query("SELECT id, email, role, clinic_id FROM app.users ORDER BY id")).rows;
const by = (email: string) => { const r = U.find((x: any) => x.email === email); return { sub: r.id as number, role: r.role as any, clinicId: r.clinic_id as number | null }; };
const clin = by("clinician@careboard.dev"), clin2 = by("clinician2@careboard.dev"), nurse = by("nurse@careboard.dev"), exec = by("executive@careboard.dev");
const ids = [clin.sub, clin2.sub];
const wipe = async () => { await db.query("DELETE FROM app.agent_actions WHERE user_id = ANY($1)", [ids]); await db.query("DELETE FROM app.agent_runs WHERE user_id = ANY($1)", [ids]); };
const high = async (clinic: number) => (await db.query("SELECT patient_id FROM clinical.care_risk WHERE tier = 'High' AND clinic_id = $1 ORDER BY points DESC, patient_id", [clinic])).rows.map((r) => r.patient_id as number);
const decide = (id: number, st: "approved" | "rejected", daysAgo = 0) =>
  db.query("UPDATE app.agent_actions SET status = $2, decided_at = now() - make_interval(days => $3::int) WHERE id = $1", [id, st, daysAgo]);
const addedReadings: number[] = [];
const switchOn = (await db.query("SELECT value FROM app.agent_settings WHERE key = 'agents_enabled'")).rows[0]?.value ?? "true";

try {
  await wipe();
  const h1 = await high(1), h2 = await high(2);
  ok("the seed has High-tier patients in both clinics", h1.length >= 1 && h2.length >= 1, `${h1.length}, ${h2.length}`);

  // pure text
  ok("the reason is built from numbers", buildReason([{ points: 5 }, { points: 3 }]) === `Weekly review: 2 High-risk patients with no follow-up proposed or decided in the last ${COOLDOWN_DAYS} days. Highest score: 5 points.`);
  ok("the reason reads right for one patient", /^Weekly review: 1 High-risk patient with/.test(buildReason([{ points: 3 }])));

  // only clinicians
  for (const [n, u] of [["a nurse", nurse], ["an executive", exec]] as const) {
    let refused = false; try { await scanForClinician(u as any); } catch { refused = true; }
    ok(`${n} cannot be scanned`, refused);
  }

  // dry run writes nothing
  const dry = await scanForClinician(clin, { dryRun: true });
  ok("dry run proposes the top High patients of the clinic", dry.status === "dry_run" && JSON.stringify(dry.patient_ids) === JSON.stringify(h1.slice(0, MAX_PATIENTS)), JSON.stringify(dry));
  ok("dry run writes no run and no action", (await db.query("SELECT count(*)::int AS n FROM app.agent_runs WHERE user_id = $1", [clin.sub])).rows[0].n === 0);

  // real scan: one pending draft, nothing approved
  const s1 = await scanForClinician(clin);
  ok("the scan drafts a list", s1.status === "proposed", JSON.stringify(s1));
  const a1 = s1.status === "proposed" ? (await db.query("SELECT * FROM app.agent_actions WHERE id = $1", [s1.action_id])).rows[0] : null;
  ok("the draft is pending, tier 2, scheduled, and belongs to the clinician", !!a1 && a1.status === "pending" && a1.tier === 2 && a1.origin === "scheduled" && a1.user_id === clin.sub && a1.type === "followup_call_list");
  ok("every listed patient is High tier in the clinician's clinic", !!a1 && a1.payload.patient_ids.length <= MAX_PATIENTS && a1.payload.patient_ids.every((p: number) => h1.includes(p)));
  ok("nothing was decided or sent", !!a1 && a1.decided_at === null && a1.outcome === null);
  const steps = s1.status === "proposed" ? (await db.query("SELECT kind FROM app.agent_steps WHERE run_id = $1 ORDER BY seq", [s1.run_id])).rows.map((r) => r.kind) : [];
  ok("the run leaves a trace like a chat run", JSON.stringify(steps) === JSON.stringify(["tool", "result", "answer"]), JSON.stringify(steps));

  // a waiting draft blocks another one
  const s2 = await scanForClinician(clin);
  ok("a second scan while one draft waits is skipped", s2.status === "skipped");
  ok("no second action was created", (await db.query("SELECT count(*)::int AS n FROM app.agent_actions WHERE user_id = $1", [clin.sub])).rows[0].n === 1);

  // approved patients are not offered again, and neither are rejected ones
  const first = s1.status === "proposed" ? s1 : null;
  await decide(first!.action_id, "approved", 8);
  const s3 = await scanForClinician(clin);
  const left = h1.filter((p) => !first!.patient_ids.includes(p));
  if (left.length === 0) ok("approved patients are not offered again (nobody left)", s3.status === "nothing", JSON.stringify(s3));
  else {
    ok("approved patients are not offered again", s3.status === "proposed" && s3.patient_ids.every((p) => !first!.patient_ids.includes(p)), JSON.stringify(s3));
    if (s3.status === "proposed") {
      await decide(s3.action_id, "rejected", 0);
      const s4 = await scanForClinician(clin);
      ok("rejected patients are not offered again either", s4.status === "nothing" || (s4.status === "proposed" && s4.patient_ids.every((p) => !s3.patient_ids.includes(p) && !first!.patient_ids.includes(p))), JSON.stringify(s4));
    }
  }

  // kill switch
  const before = (await db.query("SELECT count(*)::int AS n FROM app.agent_actions WHERE user_id = $1", [clin2.sub])).rows[0].n;
  await db.query("UPDATE app.agent_settings SET value = 'false' WHERE key = 'agents_enabled'");
  const off = await scanForClinician(clin2);
  ok("with the kill switch off the scan does nothing", off.status === "skipped" && (await db.query("SELECT count(*)::int AS n FROM app.agent_actions WHERE user_id = $1", [clin2.sub])).rows[0].n === before);
  await db.query("UPDATE app.agent_settings SET value = $1 WHERE key = 'agents_enabled'", [switchOn]);

  // clinic isolation
  const c2 = await scanForClinician(clin2);
  ok("the other clinic's clinician is offered only that clinic's patients", c2.status === "proposed" && c2.patient_ids.every((p) => h2.includes(p) && !h1.includes(p)), JSON.stringify(c2));

  // outcome check: only after a week, only once, counts readings dated on or after the approval day
  const target = first!.patient_ids[0];
  const r = await db.query("INSERT INTO clinical.patient_readings (patient_id, taken_on, a1c) VALUES ($1, current_date, 7.1) RETURNING reading_id", [target]);
  addedReadings.push(r.rows[0].reading_id);
  const young = (await db.query(
    `INSERT INTO app.agent_actions (run_id, user_id, clinic_id, tier, type, payload, status, decided_at)
     VALUES ($1, $2, $3, 2, 'followup_call_list', $4, 'approved', now() - interval '2 days') RETURNING id`,
    [first!.run_id, clin.sub, clin.clinicId, JSON.stringify({ patient_ids: [target], reason: "test" })])).rows[0].id;
  const o1 = await checkOutcomes(clin);
  ok("the approval from 8 days ago is checked, the one from 2 days ago is not", o1.length === 1 && o1[0].action_id === first!.action_id, JSON.stringify(o1));
  const det = (await db.query("SELECT outcome_detail, outcome_checked_at FROM app.agent_actions WHERE id = $1", [first!.action_id])).rows[0];
  ok("one listed patient has a new reading", det.outcome_detail.with_new_reading === 1 && det.outcome_detail.with_new_a1c === 1 && det.outcome_detail.total === first!.patient_ids.length, JSON.stringify(det.outcome_detail));
  ok("the detail holds counts, not values", !JSON.stringify(det.outcome_detail).includes("7.1"));
  ok("the young approval is untouched", (await db.query("SELECT outcome_checked_at FROM app.agent_actions WHERE id = $1", [young])).rows[0].outcome_checked_at === null);
  ok("a second check does not repeat", (await checkOutcomes(clin)).length === 0);
  ok("the other clinic's clinician cannot see or check these actions", (await checkOutcomes(clin2)).length === 0);
  await db.query("UPDATE app.agent_actions SET decided_at = now() - interval '8 days' WHERE id = $1", [young]);
  const o2 = await checkOutcomes(clin);
  ok("once it is a week old the young one is checked too", o2.length === 1 && o2[0].action_id === young && o2[0].with_new_reading === 1);

  // a reading dated before the approval does not count
  const old = (await db.query(
    `INSERT INTO app.agent_actions (run_id, user_id, clinic_id, tier, type, payload, status, decided_at)
     VALUES ($1, $2, $3, 2, 'followup_call_list', $4, 'approved', now() - interval '8 days') RETURNING id`,
    [first!.run_id, clin.sub, clin.clinicId, JSON.stringify({ patient_ids: [target], reason: "test" })])).rows[0].id;
  await db.query("UPDATE clinical.patient_readings SET taken_on = current_date - 30 WHERE reading_id = $1", [addedReadings[0]]);
  const o3 = await checkOutcomes(clin);
  ok("a reading dated before the approval does not count", o3.length === 1 && o3[0].action_id === old && o3[0].with_new_reading === 0, JSON.stringify(o3));
} finally {
  await db.query("UPDATE app.agent_settings SET value = $1 WHERE key = 'agents_enabled'", [switchOn]);
  if (addedReadings.length) await db.query("DELETE FROM clinical.patient_readings WHERE reading_id = ANY($1)", [addedReadings]);
  await wipe();
  await db.end();
  await pool.end();
}
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
