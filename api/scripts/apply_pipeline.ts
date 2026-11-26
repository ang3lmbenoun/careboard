import "dotenv/config";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import pg from "pg";

// Usage (from the api folder):  npx tsx scripts/apply_pipeline.ts          -> local database
//                               npx tsx scripts/apply_pipeline.ts --neon   -> Neon
// Applies db/pipeline.sql (raw table and run history) and checks the result. Run it BEFORE apply_risk.ts and before deploying code that uses it.
const neon = process.argv.includes("--neon");
const adminUrl = neon ? process.env.NEON_ADMIN_URL : process.env.ADMIN_DATABASE_URL;
if (!adminUrl) throw new Error(neon ? "NEON_ADMIN_URL missing in api/.env" : "ADMIN_DATABASE_URL missing in api/.env");

const db = new pg.Pool({ connectionString: adminUrl });
let failed = 0;
const report = (ok: boolean, label: string) => { console.log(ok ? "PASS" : "FAIL", label); if (!ok) failed++; };
try {
  await db.query(fs.readFileSync(fileURLToPath(new URL("../../db/pipeline.sql", import.meta.url)), "utf8"));
  console.log("applied db/pipeline.sql to", neon ? "Neon" : "local database");
  const roles = (await db.query("SELECT rolname FROM pg_roles WHERE rolname IN ('role_admin','role_clinician','role_executive','role_nurse')")).rows.map((r) => r.rolname as string);
  const g = await db.query(
    `SELECT r AS role,
            has_table_privilege(r, 'app.pipeline_runs', 'SELECT') AS runs_sel,
            has_table_privilege(r, 'app.pipeline_runs', 'INSERT') AS runs_ins,
            has_table_privilege(r, 'raw.medicare_part_d_spending', 'SELECT') AS raw_sel,
            has_schema_privilege(r, 'raw', 'USAGE') AS raw_use
     FROM unnest($1::text[]) r`, [roles]);
  report(g.rows.every((r) => !r.runs_sel && !r.runs_ins), "no application role can read or write the run history");
  report(g.rows.every((r) => !r.raw_sel && !r.raw_use), "no application role can read the raw copy");
  const ap = await db.connect();
  try {
    await ap.query("BEGIN");
    await ap.query(`INSERT INTO app.pipeline_runs (load_id, pipeline, trigger, target, status, started_at) VALUES (gen_random_uuid(), 'selftest', 'manual', 'local', 'checked', now())`);
    let blocked = 0;
    for (const sql of ["UPDATE app.pipeline_runs SET status = 'failed' WHERE pipeline = 'selftest'", "DELETE FROM app.pipeline_runs WHERE pipeline = 'selftest'"]) {
      await ap.query("SAVEPOINT s");
      try { await ap.query(sql); } catch { blocked++; }
      await ap.query("ROLLBACK TO SAVEPOINT s");
    }
    report(blocked === 2, "run history cannot be edited or deleted");
  } finally { await ap.query("ROLLBACK"); ap.release(); }
} finally { await db.end(); }
process.exit(failed ? 1 : 0);
