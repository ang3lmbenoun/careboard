import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import pg from "pg";
import { AIMessage } from "@langchain/core/messages";
import { withRole, pool } from "../src/db.js";
import { AgentError, makeModel, runAgent, type Chat } from "../src/agent.js";
import type { Ctx, Fixtures, Step } from "../src/evalChecks.js";
import { CASES, CATEGORIES, type Case, type Who } from "../eval/cases.js";

// Runs the evaluation suite against the real model, on the LOCAL database only.
// Usage (from the api folder):
//   npx tsx scripts/run_evals.ts                 run every case once
//   npx tsx scripts/run_evals.ts --repeat=3      run each case 3 times (shows flaky cases)
//   npx tsx scripts/run_evals.ts --only=P1,X5    run chosen cases
//   npx tsx scripts/run_evals.ts --suites        also run the five test suites and record their counts
//   npx tsx scripts/run_evals.ts --gap=3000      milliseconds between model calls (default 2500)
const arg = (k: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split("=")[1];
const flag = (k: string) => process.argv.includes(`--${k}`);

if (flag("neon") || /neon\.tech/.test(process.env.DATABASE_URL ?? "") || /neon\.tech/.test(process.env.ADMIN_DATABASE_URL ?? "")) {
  console.error("Refusing to run: evaluations write runs and proposals and must only run on the local database.");
  process.exit(1);
}
if (!process.env.GROQ_API_KEY) { console.error("GROQ_API_KEY is not set in api/.env"); process.exit(1); }

const repeat = Math.max(1, Number(arg("repeat") ?? 1));
const only = arg("only")?.split(",").map((s) => s.trim().toUpperCase());
const gap = Number(arg("gap") ?? 2500);
const cases = CASES.filter((c) => !only || only.includes(c.id));

const admin = new pg.Pool({ connectionString: process.env.ADMIN_DATABASE_URL });

/* ---------- fixtures: read with the admin login, never shown to the agent ---------- */
const EMAIL: Record<Who, string> = {
  clinician: "clinician@careboard.dev",
  clinician2: "clinician2@careboard.dev",
  executive: "executive@careboard.dev",
  admin: "admin@careboard.dev",
  nurse: "nurse@careboard.dev",
};
const { rows: userRows } = await admin.query("SELECT id, email, role, clinic_id FROM app.users");
const claim = (who: Who) => {
  const r = userRows.find((u: any) => u.email === EMAIL[who]);
  return r ? { sub: r.id as number, role: r.role as any, clinicId: (r.clinic_id ?? null) as number | null } : null;
};
const { rows: pats } = await admin.query("SELECT patient_id, clinic_id, full_name, to_char(birth_date, 'YYYY-MM-DD') AS bd FROM clinical.patients");
const { rows: docs } = await admin.query("SELECT DISTINCT clinic_id, title FROM app.policy_chunks WHERE visibility = 'clinic'");
const fixtures = (who: Who): Fixtures => {
  const clinic = claim(who)?.clinicId ?? null;
  return {
    names: pats.map((p: any) => p.full_name),
    birthDates: pats.map((p: any) => p.bd),
    ownPatientIds: pats.filter((p: any) => p.clinic_id === clinic).map((p: any) => p.patient_id),
    otherClinicTitles: docs.filter((d: any) => d.clinic_id !== clinic).map((d: any) => d.title),
  };
};

/* ---------- model wrapper: spacing between calls and retry on rate limits ---------- */
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let last = 0;
let retries = 0;
const real = makeModel();
const model: Chat = {
  invoke: async (msgs) => {
    for (let attempt = 0; ; attempt++) {
      const wait = last + gap - Date.now();
      if (wait > 0) await sleep(wait);
      last = Date.now();
      try { return (await real.invoke(msgs)) as AIMessage; }
      catch (e: any) {
        const limited = /429|rate.?limit/i.test(String(e?.message ?? e));
        if (!limited || attempt >= 5) throw e;
        retries++;
        await sleep(8000 * (attempt + 1));
      }
    }
  },
};

/* ---------- run ---------- */
type Result = { id: string; category: string; who: Who; question: string; blurb: string; run: number; pass: boolean; why?: string; status: string; answer: string; error?: string; inconclusive?: boolean; tools: string[]; tokens: number; latencyMs: number; costUsd: number };
const results: Result[] = [];
const runIds: number[] = [];
let dailyCap = false;
console.log(`Estimated model use: about ${Math.round((cases.length * repeat * 1800) / 1000)}k tokens (a free Groq plan allows a fixed number of tokens per day for each model).`);
const original = (await admin.query("SELECT value FROM app.agent_settings WHERE key = 'daily_runs_per_user'")).rows[0]?.value ?? "40";
await admin.query("UPDATE app.agent_settings SET value = '100000' WHERE key = 'daily_runs_per_user'");

// Models emit non-breaking spaces and non-breaking hyphens; checks should read them as ordinary characters.
const clean = (t: string) => t.replace(/[\u00a0\u2007\u202f]/g, " ").replace(/[\u2010-\u2012\u2060\u2011]/g, "-");

async function runOne(c: Case, run: number): Promise<Result> {
  // A provider error (rate limit, malformed tool call) says nothing about agent behavior: retry twice, then mark inconclusive.
  let r = await runOnce(c, run);
  for (let i = 0; i < 2 && r.status === "error"; i++) r = await runOnce(c, run);
  if (r.status === "error" && /tokens per day|TPD/i.test(r.error ?? "")) dailyCap = true;
  if (r.status === "error") { r.pass = false; r.inconclusive = true; r.why = `provider error: ${r.error ?? "unknown"}`; }
  return r;
}

async function runOnce(c: Case, run: number): Promise<Result> {
  const user = claim(c.who);
  if (!user) return { id: c.id, category: c.category, who: c.who, question: c.question, blurb: c.blurb, run, pass: false, why: `no demo account for ${c.who}`, status: "skipped", answer: "", tools: [], tokens: 0, latencyMs: 0, costUsd: 0 };
  let runId = 0, status = "error", answer = "";
  try {
    const r = await runAgent(user, c.question, model);
    runId = r.runId; runIds.push(runId); status = r.status; answer = r.answer;
  } catch (e: any) {
    status = e instanceof AgentError ? `refused_${e.status}` : "error";
    answer = String(e?.message ?? e);
  }
  let err: string | undefined; let steps: Step[] = [], actions: Ctx["actions"] = [], tokens = 0, latencyMs = 0, costUsd = 0;
  if (runId) {
    steps = await withRole(user, async (cl) => (await cl.query("SELECT kind, content FROM app.agent_steps WHERE run_id = $1 ORDER BY seq", [runId])).rows);
    actions = await withRole(user, async (cl) => (await cl.query("SELECT status, payload FROM app.agent_actions WHERE run_id = $1", [runId])).rows);
    const m = (await admin.query("SELECT prompt_tokens, completion_tokens, latency_ms, error, est_cost_usd::float8 AS cost FROM app.agent_runs WHERE id = $1", [runId])).rows[0];
    err = m?.error ?? undefined; tokens = (m?.prompt_tokens ?? 0) + (m?.completion_tokens ?? 0); latencyMs = m?.latency_ms ?? 0; costUsd = m?.cost ?? 0;
  }
  answer = clean(answer);
  const v = c.check({ answer, status, steps, actions, fx: fixtures(c.who) });
  // Leave no pending proposals behind in the demo inbox.
  if (runId) await admin.query("UPDATE app.agent_actions SET status = 'rejected', decided_at = now() WHERE run_id = $1 AND status = 'pending'", [runId]);
  const tools = steps.filter((s) => s.kind === "tool").map((s) => s.content.name as string);
  return { id: c.id, category: c.category, who: c.who, question: c.question, blurb: c.blurb, run, pass: v.pass, why: v.why, status, answer, error: err, tools, tokens, latencyMs, costUsd };
}

try {
  outer: for (const c of cases) {
    for (let run = 1; run <= repeat; run++) {
      const r = await runOne(c, run);
      if (dailyCap) { process.exitCode = 2; console.error(`\nStopped: Groq's daily token limit for this model was reached at case ${c.id}. Nothing was written. Wait for the limit to reset (it frees gradually over 24 hours), run fewer cases (--only= or --repeat=1), or set GROQ_MODEL to another model.`); break outer; }
      results.push(r);
      console.log(`${r.pass ? "PASS" : "FAIL"} ${c.id}${repeat > 1 ? `#${run}` : ""} ${c.blurb}${r.pass ? "" : "  -> " + r.why}`);
    }
  }
} finally {
  // Evaluation runs must not use up the demo users' daily run allowance, so they are removed once scored (answers are kept in the results file).
  if (runIds.length) await admin.query("DELETE FROM app.agent_runs WHERE id = ANY($1::bigint[])", [runIds]);
  await admin.query("UPDATE app.agent_settings SET value = $1 WHERE key = 'daily_runs_per_user'", [original]);
}

if (dailyCap) { await admin.end(); await pool.end(); process.exit(2); }

/* ---------- optional: run the five test suites and record their counts ---------- */
let suites: { name: string; passed: number; failed: number; note?: string }[] = [];
if (flag("suites")) {
  for (const name of ["test_agent", "test_policies", "test_nurse", "test_digest", "test_eval_checks"]) {
    const r = spawnSync("npx", ["tsx", `scripts/${name}.ts`], { encoding: "utf8", shell: true });
    const m = /(\d+) passed, (\d+) failed/.exec((r.stdout ?? "") + (r.stderr ?? ""));
    suites.push({ name, passed: m ? Number(m[1]) : 0, failed: m ? Number(m[2]) : -1, note: m ? undefined : ((r.stdout ?? "") + (r.stderr ?? "")).trim().split("\n").slice(-3).join(" | ").slice(0, 300) });
    console.log(`${name}: ${m ? m[0] : "no result line: " + suites[suites.length - 1].note}`);
  }
}

/* ---------- summary ---------- */
const pct = (a: number[], p: number) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]; };
const byCase = new Map<string, Result[]>();
for (const r of results) byCase.set(r.id, [...(byCase.get(r.id) ?? []), r]);
const caseRows = [...byCase.entries()].map(([id, rs]) => ({ id, category: rs[0].category, who: rs[0].who, blurb: rs[0].blurb, question: rs[0].question, passes: rs.filter((x) => x.pass).length, inconclusive: rs.filter((x) => x.inconclusive).length, runs: rs.length, why: rs.find((x) => !x.pass)?.why ?? null, answer: rs[rs.length - 1].answer, tools: rs[rs.length - 1].tools }));
const categories = Object.keys(CATEGORIES).map((k) => {
  const rs = results.filter((r) => r.category === k && !r.inconclusive);
  return { key: k, title: CATEGORIES[k], passed: rs.filter((r) => r.pass).length, total: rs.length };
}).filter((c) => c.total);
const modelRuns = results.filter((r) => r.tokens > 0);
const summary = {
  generatedAt: new Date().toISOString(),
  model: process.env.GROQ_MODEL ?? "llama-3.3-70b-versatile",
  cases: caseRows.length, runs: results.length - results.filter((r) => r.inconclusive).length, repeat,
  passed: results.filter((r) => r.pass).length, failed: results.filter((r) => !r.pass && !r.inconclusive).length, inconclusive: results.filter((r) => r.inconclusive).length,
  allPassedEveryRepeat: caseRows.filter((c) => c.passes === c.runs).length,
  rateLimitRetries: retries,
  latencyMs: { p50: pct(modelRuns.map((r) => r.latencyMs), 50), p95: pct(modelRuns.map((r) => r.latencyMs), 95) },
  tokensPerRun: { p50: pct(modelRuns.map((r) => r.tokens), 50), p95: pct(modelRuns.map((r) => r.tokens), 95) },
  totalCostUsd: modelRuns.reduce((a, r) => a + r.costUsd, 0),
  costConfigured: Number(process.env.AGENT_USD_PER_1M_INPUT ?? 0) > 0,
  categories, caseRows, suites,
};
const dir = path.resolve(import.meta.dirname ?? ".", "../eval/results");
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, "latest.json"), JSON.stringify(summary, null, 2));

const leak = categories.filter((c) => ["privacy", "cross_clinic", "injection"].includes(c.key));
const md = [
  `# CareBoard agent evaluation`,
  ``,
  `Generated ${summary.generatedAt} on model \`${summary.model}\`. ${summary.cases} cases, ${summary.runs} runs${repeat > 1 ? ` (${repeat} repeats each)` : ""}. Checks are deterministic code, no model grades another model.`,
  ``,
  `**${summary.passed} of ${summary.runs} runs passed.**${summary.inconclusive ? ` ${summary.inconclusive} run(s) were inconclusive because the model provider returned an error twice in a row; they are excluded from the count.` : ""} Latency p50 ${summary.latencyMs.p50} ms, p95 ${summary.latencyMs.p95} ms. Tokens per run p50 ${summary.tokensPerRun.p50}, p95 ${summary.tokensPerRun.p95}.${summary.costConfigured ? ` Estimated cost $${summary.totalCostUsd.toFixed(4)} for the whole suite.` : ""}`,
  ``,
  `## Safety categories`,
  ``,
  `| Category | Passed | What it proves |`,
  `|---|---|---|`,
  ...categories.map((c) => `| ${c.key} | ${c.passed}/${c.total} | ${c.title} |`),
  ``,
  leak.length ? `Leak related categories (privacy, cross clinic, injection): ${leak.reduce((a, c) => a + c.passed, 0)} of ${leak.reduce((a, c) => a + c.total, 0)} runs passed.` : ``,
  ``,
  `## Cases`,
  ``,
  `| Case | Role | Test | Result |`,
  `|---|---|---|---|`,
  ...caseRows.map((c) => `| ${c.id} | ${c.who} | ${c.blurb} | ${c.passes === c.runs ? "pass" : `FAIL ${c.passes}/${c.runs}${c.why ? " (" + c.why.replace(/\|/g, "/") + ")" : ""}`} |`),
  ``,
  suites.length ? `## Test suites\n\n| Suite | Passed | Failed |\n|---|---|---|\n${suites.map((s) => `| ${s.name} | ${s.failed < 0 ? "did not complete" : s.passed} | ${s.failed < 0 ? "" : s.failed} |`).join("\n")}\n` : ``,
  `## Limits`,
  ``,
  `- Temperature 0 does not make a hosted model fully repeatable. Use \`--repeat\` to see flaky cases.`,
  `- Cases cover the failure modes I thought of. A pass means these cases passed, not that no case exists that fails.`,
  `- Refusal detection is a phrase check. It can miss an unusual refusal wording; privacy and cross clinic checks do not depend on it, they inspect the data returned.`,
  `- Evaluated on synthetic data in a local database.`,
].join("\n");
const docs_dir = path.resolve(import.meta.dirname ?? ".", "../../docs");
fs.mkdirSync(docs_dir, { recursive: true });
fs.writeFileSync(path.join(docs_dir, "eval-report.md"), md);

console.log(`\n${summary.passed} passed, ${summary.failed} failed (${summary.cases} cases, ${summary.runs} runs${summary.inconclusive ? ", " + summary.inconclusive + " inconclusive" : ""})`);
console.log(`Wrote api/eval/results/latest.json and docs/eval-report.md`);
await admin.end();
await pool.end();
process.exit(summary.failed ? 1 : 0);
