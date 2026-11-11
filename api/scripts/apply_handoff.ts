import "dotenv/config";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import pg from "pg";

// Usage (from the api folder):  npx tsx scripts/apply_handoff.ts          -> local database
//                               npx tsx scripts/apply_handoff.ts --neon   -> Neon
// Applies db/handoff.sql (nurse and clinician hand-off) and checks the result. Run it BEFORE deploying code that uses it.
const neon = process.argv.includes("--neon");
const adminUrl = neon ? process.env.NEON_ADMIN_URL : process.env.ADMIN_DATABASE_URL;
if (!adminUrl) throw new Error(neon ? "NEON_ADMIN_URL missing in api/.env" : "ADMIN_DATABASE_URL missing in api/.env");
const db = new pg.Pool({ connectionString: adminUrl });
let failed = 0;
const report = (ok: boolean, label: string) => { console.log(ok ? "PASS" : "FAIL", label); if (!ok) failed++; };
try {
  await db.query(fs.readFileSync(fileURLToPath(new URL("../../db/handoff.sql", import.meta.url)), "utf8"));
  console.log("applied db/handoff.sql to", neon ? "Neon" : "local database");
  const col = (t: string) => db.query("SELECT 1 FROM information_schema.columns WHERE table_schema='clinical' AND table_name=$1 AND column_name='entered_via'", [t]);
  report((await col("patients")).rowCount === 1 && (await col("patient_medications")).rowCount === 1 && (await col("patient_readings")).rowCount === 1, "records carry who entered them");
  const g = (await db.query(`SELECT has_column_privilege('role_clinician','clinical.patients','entered_via','SELECT') AS c_sel,
      has_column_privilege('role_clinician','clinical.patients','entered_via','INSERT') AS c_ins,
      has_column_privilege('role_nurse','clinical.patients','entered_via','INSERT') AS n_ins`)).rows[0];
  report(g.c_sel, "a clinician can read who entered a record");
  report(!g.c_ins && !g.n_ins, "nobody can type the label themselves");
} finally { await db.end(); }
process.exit(failed ? 1 : 0);
