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


// Grounding gate: a figure the tools never returned is corrected once, then refused
const scriptSeen = (...replies: AIMessage[]) => { const seen: number[] = []; let i = 0; return { chat: { invoke: async (m: any) => { seen.push(m.length); return replies[Math.min(i++, replies.length - 1)]; } } as Chat, seen }; };
let g = scriptSeen(call("query_insights", { report: "no_show_summary" }), say("Clinic 2 has a no show rate of 77.7%."), say("Clinic 2 has a higher no show rate."));
r = await runAgent(exec, "Which clinic has the higher no-show rate?", g.chat);
s = await stepsOf(exec, r.runId);
ok("an invented figure is sent back once and the corrected answer stands", r.status === "finished" && !/77\.7/.test(r.answer) && s.some((x: any) => x.kind === "blocked" && x.content.name === "grounding"));
g = scriptSeen(call("query_insights", { report: "no_show_summary" }), say("It is 77.7%."), say("Really 88.8%."));
r = await runAgent(exec, "Which clinic has the higher no-show rate?", g.chat);
ok("a figure that stays ungrounded is refused", /could not verify/.test(r.answer) && !/88\.8|77\.7/.test(r.answer));
r = await runAgent(exec, "Compare spend", script(call("query_insights", { report: "spend_compare" }), say("Medicare spent more than Medicaid.")));
ok("an answer with no figures passes the gate untouched", r.answer === "Medicare spent more than Medicaid.");

// Clinical scope: refused in code before the model is called
let called = 0;
const spy: Chat = { invoke: async () => { called++; return say("Switch them to semaglutide 1 mg."); } };
r = await runAgent(clin, "Which drug should we switch our patients to for better outcomes?", spy);
s = await stepsOf(clin, r.runId);
ok("a treatment question is refused without calling the model", called === 0 && r.status === "finished" && /can't/.test(r.answer) && s.some((x: any) => x.kind === "blocked" && x.content.name === "clinical_scope"));
r = await runAgent(clin, "Here are the patient numbers 3, 5, 9. Which drug should they switch to?", spy);
ok("supplying patient numbers does not reopen the refusal", called === 0 && !/semaglutide/.test(r.answer));

// Total-time cap: a model call that overruns is cut off, the run is closed as stopped, nothing is sent
const slow: Chat = { invoke: () => new Promise((res) => setTimeout(() => res(say("Too late.")), 400)) };
r = await runAgent(clin, "Which patients need follow up?", slow, { maxMs: 100 });
s = await stepsOf(clin, r.runId);
ok("a slow model is stopped at the time limit", r.status === "stopped" && /taking longer than expected/.test(r.answer) && !/Too late/.test(r.answer));
ok("the time limit is traced as a blocked step", s.some((x: any) => x.kind === "blocked" && x.content.name === "time_limit"));
const rowT = await withRole(clin, async (c) => (await c.query("SELECT status, answer, error FROM app.agent_runs WHERE id = $1", [r.runId])).rows[0]);
ok("the stopped run is closed in the database, not an error", rowT.status === "stopped" && rowT.error === null);
let slowCalls = 0;
const slowTool: Chat = { invoke: async () => { slowCalls++; await new Promise((x) => setTimeout(x, 120)); return call("query_insights", { report: "no_show_summary" }, "t" + slowCalls); } };
r = await runAgent(exec, "Compare no-shows", slowTool, { maxMs: 200 });
ok("a loop of slow steps stops once the total time is spent", r.status === "stopped" && slowCalls <= 2, `calls=${slowCalls}`);
r = await runAgent(exec, "Compare Medicaid and Medicare spend", script(call("query_insights", { report: "spend_compare" }), say("Medicare spent more.")), { maxMs: 30_000 });
ok("a normal run within the limit is unaffected", r.status === "finished" && r.answer === "Medicare spent more.");

// A model reply that arrives after the deadline must change nothing: no action, no draft, no trace step after time_limit.
{
  let lateDelivered = false;
  const lateAction: Chat = { invoke: () => new Promise((res) => setTimeout(() => { lateDelivered = true; res(call("propose_action", { type: "followup_call_list", patient_ids: [pid], reason: "Late proposal that must never be stored" }, "late1")); }, 300)) };
  const before = (await admin_db.query("SELECT count(*)::int n FROM app.agent_actions")).rows[0].n;
  r = await runAgent(clin, "Draft a call list for follow up", lateAction, { maxMs: 80 });
  await new Promise((x) => setTimeout(x, 500)); // let the late reply arrive
  s = await stepsOf(clin, r.runId);
  const kinds = s.map((x: any) => x.kind);
  const tl = s.findIndex((x: any) => x.kind === "blocked" && x.content.name === "time_limit");
  const after = (await admin_db.query("SELECT count(*)::int n FROM app.agent_actions")).rows[0].n;
  ok("the late reply really did arrive after the run closed", lateDelivered);
  ok("a late tool call stores no action", r.status === "stopped" && after === before && (await admin_db.query("SELECT count(*)::int n FROM app.agent_actions WHERE run_id = $1", [r.runId])).rows[0].n === 0);
  ok("nothing is traced after the time_limit step", tl >= 0 && tl === s.length - 1 && !kinds.includes("tool") && !kinds.includes("result") && !kinds.includes("answer"));
  const rowL = (await admin_db.query("SELECT status, answer FROM app.agent_runs WHERE id = $1", [r.runId])).rows[0];
  ok("the closed run is not rewritten by the late reply", rowL.status === "stopped" && rowL.answer === r.answer && !/Late proposal/.test(rowL.answer));

  // When the time is already spent between steps, the next model call is not even started.
  let invokes = 0;
  const many = new AIMessage({ content: "", tool_calls: Array.from({ length: 30 }, (_, k) => ({ name: "query_insights", args: { report: "no_show_summary" }, id: "m" + k, type: "tool_call" as const })), usage_metadata: { input_tokens: 100, output_tokens: 20, total_tokens: 120 } });
  // Fake clock: the model reply is instant, but the clock is moved past the limit, as if running the 30 tools took too long.
  let fakeNow = 1_000_000;
  const spent: Chat = { invoke: async () => { invokes++; fakeNow += 200; return many; } };
  r = await runAgent(exec, "Compare no-shows", spent, { maxMs: 150, now: () => fakeNow });
  ok("a model call is not started once the time is spent", r.status === "stopped" && invokes === 1, `invokes=${invokes}`);
}

console.log(`\n${pass} passed, ${fail} failed`);
await pool.end();
await admin_db.end();
process.exit(fail ? 1 : 0);
