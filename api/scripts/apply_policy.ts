import "dotenv/config";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import pg from "pg";

// Usage (from the api folder):  npx tsx scripts/apply_policy.ts          -> local database
//                               npx tsx scripts/apply_policy.ts --neon   -> Neon
// Applies db/policy.sql (pgvector extension, policy_chunks table, row-level security) and checks the result.
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
  await db.query(fs.readFileSync(fileURLToPath(new URL("../../db/policy.sql", import.meta.url)), "utf8"));
  console.log("applied db/policy.sql to", neon ? "Neon" : "local database");
  const ext = await db.query("SELECT 1 FROM pg_extension WHERE extname = 'vector'");
  report(ext.rowCount === 1, "pgvector extension is installed");
  const rls = await db.query("SELECT relrowsecurity FROM pg_class WHERE oid = 'app.policy_chunks'::regclass");
  report(rls.rows[0]?.relrowsecurity === true, "row-level security is on for policy_chunks");
  const w = await db.query(
    "SELECT has_table_privilege('role_clinician','app.policy_chunks','INSERT') AS a, has_table_privilege('role_admin','app.policy_chunks','UPDATE') AS b, has_table_privilege('role_executive','app.policy_chunks','DELETE') AS c"
  );
  report(!w.rows[0].a && !w.rows[0].b && !w.rows[0].c, "application roles cannot write to policy_chunks");
  const pol = await db.query("SELECT 1 FROM pg_policies WHERE schemaname='app' AND tablename='policy_chunks' AND policyname='chunks_visible'");
  report(pol.rowCount === 1, "chunks_visible policy exists");
} finally {
  await db.end();
}
process.exit(failed ? 1 : 0);
