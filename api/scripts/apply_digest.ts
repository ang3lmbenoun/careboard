import "dotenv/config";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import pg from "pg";

// Usage (from the api folder):  npx tsx scripts/apply_digest.ts          -> local database
//                               npx tsx scripts/apply_digest.ts --neon   -> Neon
// Applies db/digest.sql (allow list and send log) and checks the result. Run it BEFORE deploying code that uses it.
const neon = process.argv.includes("--neon");
const adminUrl = neon ? process.env.NEON_ADMIN_URL : process.env.ADMIN_DATABASE_URL;
if (!adminUrl) throw new Error(neon ? "NEON_ADMIN_URL missing in api/.env" : "ADMIN_DATABASE_URL missing in api/.env");

const db = new pg.Pool({ connectionString: adminUrl });
let failed = 0;
const report = (ok: boolean, label: string) => { console.log(ok ? "PASS" : "FAIL", label); if (!ok) failed++; };
try {
  await db.query(fs.readFileSync(fileURLToPath(new URL("../../db/digest.sql", import.meta.url)), "utf8"));
  console.log("applied db/digest.sql to", neon ? "Neon" : "local database");
  const g = await db.query(`SELECT has_table_privilege('role_admin','app.digest_log','INSERT') AS a_ins,
      has_table_privilege('role_admin','app.digest_log','UPDATE') AS a_upd, has_table_privilege('role_admin','app.digest_log','DELETE') AS a_del,
      has_table_privilege('role_executive','app.digest_log','SELECT') AS e_sel, has_table_privilege('role_clinician','app.digest_recipients','SELECT') AS c_sel`);
  const r = g.rows[0];
  report(r.a_ins, "admin can write the send log");
  report(!r.a_upd && !r.a_del, "nobody can edit or delete the send log");
  report(!r.e_sel && !r.c_sel, "executive and clinician cannot read the log or the allow list");
  report((await db.query("SELECT 1 FROM pg_indexes WHERE indexname = 'digest_one_send_per_day'")).rowCount === 1, "one real send per recipient per day is enforced");
} finally { await db.end(); }
process.exit(failed ? 1 : 0);
