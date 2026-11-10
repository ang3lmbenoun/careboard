import "dotenv/config";
import { AIMessage } from "@langchain/core/messages";
import pg from "pg";
import { pool, withRole } from "../src/db.js";
import { runAgent, type Chat } from "../src/agent.js";

// Tests the agent loop and its guardrails with a scripted stand-in for the model (no API key, no network).
// Usage (from the api folder):  npx tsx scripts/test_agent.ts
let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, extra = "") => {
  cond ? pass++ : fail++;
  console.log(`${cond ? "PASS" : "FAIL"} ${name}${cond ? "" : "  " + extra}`);
};

// A fake model that returns a fixed script, one reply per call.
const script = (...replies: AIMessage[]): Chat => {
  let i = 0;
  return { invoke: async () => replies[Math.min(i++, replies.length - 1)] };
};
const call = (name: string, args: object, id = "c1") =>
  new AIMessage({ content: "", tool_calls: [{ name, args, id, type: "tool_call" }], usage_metadata: { input_tokens: 100, output_tokens: 20, total_tokens: 120 } });
const say = (text: string) => new AIMessage({ content: text, usage_metadata: { input_tokens: 100, output_tokens: 30, total_tokens: 130 } });

// Test fixtures are read with the admin login; the agent itself only ever runs as the signed-in role.
const admin_db = new pg.Pool({ connectionString: process.env.ADMIN_DATABASE_URL });
const { rows: users } = await admin_db.query("SELECT id, role, clinic_id FROM app.users");
const u = (role: string) => {
  const r = users.find((x: any) => x.role === role);
  return { sub: r.id, role: role as any, clinicId: r.clinic_id as number | null };
};
const clin = u("clinician"), exec = u("executive"), admin = u("admin");
const stepsOf = async (user: any, id: number) =>
  withRole(user, async (c) => (await c.query("SELECT kind, content FROM app.agent_steps WHERE run_id = $1 ORDER BY seq", [id])).rows);

// 1. Executive can read spend and the run is traced
let r = await runAgent(exec, "Compare Medicaid and Medicare spend", script(call("query_insights", { report: "spend_compare" }), say("Medicare spent more.")));
let s = await stepsOf(exec, r.runId);
ok("executive spend report finishes", r.status === "finished" && s.some((x: any) => x.kind === "result"));

// 2. Executive cannot read the patient worklist (refused before any query), nor propose an action
r = await runAgent(exec, "Which patients need follow up?", script(call("query_insights", { report: "risk_worklist" }), say("I cannot.")));
s = await stepsOf(exec, r.runId);
ok("executive blocked from risk_worklist", s.some((x: any) => x.kind === "blocked"));
r = await runAgent(exec, "Propose a call list", script(call("propose_action", { type: "followup_call_list", patient_ids: [1], reason: "test reason" }), say("no")));
s = await stepsOf(exec, r.runId);
ok("executive blocked from propose_action", s.some((x: any) => x.kind === "blocked"));

// 3. Clinician: worklist returns only own clinic, by number, no names
r = await runAgent(clin, "Which patients need follow up?", script(call("query_insights", { report: "risk_worklist" }), say("Here they are.")));
s = await stepsOf(clin, r.runId);
const wl = s.find((x: any) => x.kind === "result")?.content.rows ?? [];
const ownIds = (await admin_db.query("SELECT patient_id FROM clinical.patients WHERE clinic_id = $1", [clin.clinicId])).rows.map((x: any) => x.patient_id);
ok("clinician worklist has rows", wl.length > 0);
ok("clinician worklist only own clinic", wl.every((x: any) => ownIds.includes(x.patient_id)));
ok("worklist has no name or birth date fields", wl.every((x: any) => !("full_name" in x) && !("birth_date" in x)));

// 4. Tier 2: a proposal is stored pending, nothing executes
const pid = wl[0].patient_id;
r = await runAgent(clin, "Draft a call list", script(call("propose_action", { type: "followup_call_list", patient_ids: [pid], reason: "High risk this week" }), say("Queued.")));
const pend = await withRole(clin, async (c) => (await c.query("SELECT id, status, tier FROM app.agent_actions WHERE run_id = $1", [r.runId])).rows);
ok("tier 2 action is pending", pend.length === 1 && pend[0].status === "pending" && pend[0].tier === 2);

// 5. Made-up or other-clinic patient numbers are rejected
const other = (await admin_db.query("SELECT patient_id FROM clinical.patients WHERE clinic_id <> $1 LIMIT 1", [clin.clinicId])).rows[0].patient_id;
r = await runAgent(clin, "Call list for another clinic", script(call("propose_action", { type: "followup_call_list", patient_ids: [other], reason: "Attempt" }), say("no")));
s = await stepsOf(clin, r.runId);
ok("other clinic patient proposal blocked", s.some((x: any) => x.kind === "blocked"));
ok("no action stored for it", (await withRole(clin, async (c) => (await c.query("SELECT 1 FROM app.agent_actions WHERE run_id = $1", [r.runId])).rowCount)) === 0);

// 6. Unknown tool is refused
r = await runAgent(clin, "Try something else", script(call("run_sql", { sql: "select * from clinical.patients" }), say("no")));
s = await stepsOf(clin, r.runId);
ok("tool outside allow list refused", s.some((x: any) => x.kind === "blocked"));

// 7. Row-level security on the logs: users see only their own runs; admin sees all
const clinRuns = await withRole(clin, async (c) => (await c.query("SELECT DISTINCT user_id FROM app.agent_runs")).rows);
ok("clinician sees only own runs", clinRuns.length === 1 && clinRuns[0].user_id === clin.sub);
const adminRuns = await withRole(admin, async (c) => (await c.query("SELECT DISTINCT user_id FROM app.agent_runs")).rows);
ok("admin sees every user's runs", adminRuns.length >= 2);

// 8. Nobody can delete history or edit a step
const tryFail = async (user: any, sql: string) => {
  try { await withRole(user, (c) => c.query(sql)); return false; } catch (e: any) { return e.code === "42501"; }
};
ok("cannot delete a run", await tryFail(clin, "DELETE FROM app.agent_runs"));
ok("cannot edit a step", await tryFail(clin, "UPDATE app.agent_steps SET content = '{}'"));
ok("cannot read names even through the agent role path", await tryFail(clin, "SELECT full_name FROM clinical.patients"));

// 9. Budgets: step limit and token limit
const loop = script(call("query_insights", { report: "spend_compare" }));
r = await runAgent(exec, "Loop forever", loop);
ok("step limit stops a looping model", r.status === "stopped");
await admin_db.query("UPDATE app.agent_settings SET value = '150' WHERE key = 'max_tokens_per_run'");
r = await runAgent(exec, "Use many tokens", script(call("query_insights", { report: "spend_compare" })));
ok("token limit stops a run", r.status === "stopped" && /token/i.test(r.answer));
await admin_db.query("UPDATE app.agent_settings SET value = '8000' WHERE key = 'max_tokens_per_run'");

// 10. Kill switch: only admin can flip it, and it stops runs
ok("clinician cannot flip the kill switch", await tryFail(clin, "UPDATE app.agent_settings SET value = 'false' WHERE key = 'agents_enabled'"));
await withRole(admin, (c) => c.query("UPDATE app.agent_settings SET value = 'false' WHERE key = 'agents_enabled'"));
let blocked = false;
try { await runAgent(exec, "Hello", script(say("hi"))); } catch (e: any) { blocked = e.status === 503; }
ok("kill switch blocks new runs", blocked);
await withRole(admin, (c) => c.query("UPDATE app.agent_settings SET value = 'true' WHERE key = 'agents_enabled'"));

// 11. A model error is recorded and changes nothing
const boom: Chat = { invoke: async () => { throw new Error("upstream failure"); } };
r = await runAgent(clin, "Anything", boom);
ok("model failure is recorded as an error run", r.status === "error");

console.log(`\n${pass} passed, ${fail} failed`);
await pool.end();
await admin_db.end();
process.exit(fail ? 1 : 0);
