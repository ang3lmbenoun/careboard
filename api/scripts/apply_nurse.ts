import "dotenv/config";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import pg from "pg";

// Usage (from the api folder):  npx tsx scripts/apply_nurse.ts          -> local database
//                               npx tsx scripts/apply_nurse.ts --neon   -> Neon
// Applies db/nurse.sql (the nurse data-entry role) and checks the result. Run it BEFORE deploying the code that
// uses it, then seed the demo nurse with:  npx tsx src/seed.ts   (add --neon for Neon). Safe to run more than once.
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
  const need = await db.query("SELECT 1 FROM information_schema.columns WHERE table_schema='clinical' AND table_name='patients' AND column_name='payer'");
  if (need.rowCount === 0) {
    console.error("The patients table has no payer column yet. Run  npx tsx scripts/seed_patients.ts" + (neon ? " --schema-only --neon" : "") + "  first, then run this again.");
    process.exit(1);
  }
  await db.query(fs.readFileSync(fileURLToPath(new URL("../../db/nurse.sql", import.meta.url)), "utf8"));
  console.log("applied db/nurse.sql to", neon ? "Neon" : "local database");
  report((await db.query("SELECT 1 FROM pg_roles WHERE rolname = 'role_nurse'")).rowCount === 1, "role_nurse exists");
  const p = await db.query(
    `SELECT has_column_privilege('role_nurse','clinical.patients','full_name','SELECT') AS name_read,
            has_table_privilege('role_nurse','clinical.patients','UPDATE') AS upd,
            has_table_privilege('role_nurse','clinical.patients','DELETE') AS del,
            has_table_privilege('role_nurse','clinical.care_risk','SELECT') AS risk,
            has_table_privilege('role_nurse','app.audit_log','SELECT') AS audit_read,
            has_table_privilege('role_nurse','app.agent_runs','SELECT') AS agent`
  );
  const r = p.rows[0];
  report(!r.name_read, "nurse cannot read patient names");
  report(!r.upd && !r.del, "nurse cannot update or delete patients");
  report(!r.risk && !r.audit_read && !r.agent, "nurse cannot read risk worklist, audit log or agent data");
  const rls = await db.query("SELECT count(*)::int AS n FROM pg_policies WHERE schemaname='clinical' AND policyname LIKE 'nurse_%'");
  report(rls.rows[0].n === 6, "six nurse row-level policies exist (found " + rls.rows[0].n + ")");
  report((await db.query("SELECT 1 FROM pg_constraint WHERE conname = 'users_role_check' AND pg_get_constraintdef(oid) LIKE '%nurse%'")).rowCount === 1, "users.role accepts nurse");
} finally {
  await db.end();
}
process.exit(failed ? 1 : 0);
