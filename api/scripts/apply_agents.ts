import "dotenv/config";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import pg from "pg";

// Usage (from the api folder):  npx tsx scripts/apply_agents.ts          -> local database
//                               npx tsx scripts/apply_agents.ts --neon   -> Neon
// Applies db/agents.sql (agent run log, step trace, proposed actions, kill switch) and checks the result.
// Run it BEFORE deploying the code that uses it. Safe to run more than once.
const neon = process.argv.includes("--neon");
const adminUrl = neon ? process.env.NEON_ADMIN_URL : process.env.ADMIN_DATABASE_URL;
if (!adminUrl) throw new Error(neon ? "NEON_ADMIN_URL missing in api/.env" : "ADMIN_DATABASE_URL missing in api/.env");

const db = new pg.Pool({ connectionString: adminUrl });
let failed = 0;
const report = (ok: boolean, label: string) => {
  console.log(ok ? "PASS" : "FAIL", label);
  if (!ok) failed++;
};
try {
  await db.query(fs.readFileSync(fileURLToPath(new URL("../../db/agents.sql", import.meta.url)), "utf8"));
  console.log("applied db/agents.sql to", neon ? "Neon" : "local database");
  const rls = await db.query(
    "SELECT relname, relrowsecurity FROM pg_class WHERE relnamespace = 'app'::regnamespace AND relname IN ('agent_runs','agent_steps','agent_actions')"
  );
  report(rls.rowCount === 3 && rls.rows.every((r) => r.relrowsecurity), "row-level security is on for runs, steps and actions");
  const set = await db.query("SELECT value FROM app.agent_settings WHERE key = 'agents_enabled'");
  report(set.rowCount === 1, "kill switch row exists (agents_enabled = " + set.rows[0]?.value + ")");
  const del = await db.query(
    "SELECT has_table_privilege('role_clinician','app.agent_runs','DELETE') AS d1, has_table_privilege('role_admin','app.agent_steps','DELETE') AS d2"
  );
  report(!del.rows[0].d1 && !del.rows[0].d2, "no role can delete run history");
  const kill = await db.query(
    "SELECT has_column_privilege('role_clinician','app.agent_settings','value','UPDATE') AS c, has_column_privilege('role_admin','app.agent_settings','value','UPDATE') AS a"
  );
  report(!kill.rows[0].c && kill.rows[0].a, "only admin can change the kill switch");
} finally {
  await db.end();
}
process.exit(failed ? 1 : 0);
