import "dotenv/config";
import pg from "pg";

// Tests the three Medicare pipeline freshness checks inside app.data_checks() with made-up run history.
// Everything happens in one transaction that is rolled back, so no real run is touched.
// Run against a LOCAL database only. Usage (api folder): npx tsx scripts/test_pipeline_db.ts
let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, extra = "") => { cond ? pass++ : fail++; console.log(`${cond ? "PASS" : "FAIL"} ${name}${cond ? "" : "  " + extra}`); };
const db = new pg.Pool({ connectionString: process.env.ADMIN_DATABASE_URL });
const c = await db.connect();
const checks = async () => (await c.query("SELECT name, status, detail FROM app.data_checks() WHERE area = 'Medicare pipeline'")).rows as { name: string; status: string; detail: string }[];
const get = async (name: string) => (await checks()).find((r) => r.name === name)!;
let seq = 0;
const run = (status: string, sha: string | null, daysAgo: number) => c.query(
  `INSERT INTO app.pipeline_runs (load_id, pipeline, trigger, target, status, started_at, finished_at, sha256)
   VALUES (gen_random_uuid(), 'medicare_part_d', 'manual', 'local', $1, now() - make_interval(days => $2::int), now() - make_interval(days => $2::int), $3)`, [status, daysAgo, sha]).then(() => seq++);
const clear = async () => { await c.query("DELETE FROM app.pipeline_runs"); };
try {
  await c.query("BEGIN");
  await c.query("ALTER TABLE app.pipeline_runs DISABLE TRIGGER pipeline_runs_no_change"); // rolled back with everything else
  await clear();

  // before any run: no standing warning
  ok("three pipeline checks exist", (await checks()).length === 3);
  let r = await get("Last pipeline run");
  ok("no runs yet: pass, says pipeline not used", r.status === "pass" && /not used yet/.test(r.detail), r.detail);
  ok("no runs yet: file check passes", (await get("Loaded file still current")).status === "pass");

  // age of the last good run
  for (const [days, want] of [[0, "pass"], [44, "pass"], [45, "pass"], [46, "warn"], [91, "warn"]] as const) {
    await clear(); await run("checked", "a", days);
    r = await get("Last pipeline run");
    ok(`last run ${days} days ago is ${want}`, r.status === want, `${r.status}: ${r.detail}`);
  }
  await clear(); await run("no_change", "a", 3);
  ok("a no_change run counts as a check", (await get("Last pipeline run")).status === "pass");
  await clear(); await run("success", "a", 3); await run("failed", null, 0);
  r = await get("Last pipeline run");
  ok("a failed latest run fails the check", r.status === "fail", r.status);
  await clear(); await run("failed", null, 5); await run("success", "a", 1);
  ok("a success after a failure passes again", (await get("Last pipeline run")).status === "pass");

  // loaded file vs latest download
  await clear(); await run("success", "aaa", 10); await run("checked", "aaa", 1);
  ok("same hash: file is current", (await get("Loaded file still current")).status === "pass");
  await clear(); await run("success", "aaa", 40); await run("checked", "bbb", 1);
  r = await get("Loaded file still current");
  ok("different hash: warns that CMS changed the file", r.status === "warn" && /CMS changed/.test(r.detail), r.status);
  await clear(); await run("checked", "bbb", 1);
  ok("only checked runs, nothing applied yet: pass", (await get("Loaded file still current")).status === "pass");
  await clear(); await run("success", "aaa", 40); await run("checked", "bbb", 20); await run("no_change", "bbb", 1);
  ok("after the new file is applied the warning clears", (await get("Loaded file still current")).status === "pass");

  // newest data year, from the loaded data
  const y = (await c.query("SELECT max(year)::int AS y FROM serving.medicare_part_d_annual")).rows[0].y;
  const want = y >= new Date().getFullYear() - 3 ? "pass" : "warn";
  ok(`newest year ${y} gives ${want}`, (await get("Newest data year")).status === want);
} finally {
  await c.query("ROLLBACK");
  c.release();
}
const left = (await db.query("SELECT count(*)::int AS n FROM app.pipeline_runs")).rows[0].n;
console.log(`(rolled back; ${left} real runs still in the table)`);
await db.end();
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
