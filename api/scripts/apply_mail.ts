import "dotenv/config";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import pg from "pg";

// Usage (from the api folder):  npx tsx scripts/apply_mail.ts          -> local database
//                               npx tsx scripts/apply_mail.ts --neon   -> Neon
// Applies db/mail.sql (follow-up email action type) and checks the result. Run it BEFORE deploying code that uses it.
const neon = process.argv.includes("--neon");
const adminUrl = neon ? process.env.NEON_ADMIN_URL : process.env.ADMIN_DATABASE_URL;
if (!adminUrl) throw new Error(neon ? "NEON_ADMIN_URL missing in api/.env" : "ADMIN_DATABASE_URL missing in api/.env");
const db = new pg.Pool({ connectionString: adminUrl });
let failed = 0;
const report = (ok: boolean, label: string) => { console.log(ok ? "PASS" : "FAIL", label); if (!ok) failed++; };
try {
  await db.query(fs.readFileSync(fileURLToPath(new URL("../../db/mail.sql", import.meta.url)), "utf8"));
  console.log("applied db/mail.sql to", neon ? "Neon" : "local database");
  report((await db.query("SELECT 1 FROM information_schema.columns WHERE table_schema='app' AND table_name='agent_actions' AND column_name='outcome'")).rowCount === 1, "agent_actions has an outcome column");
  const ix = (await db.query("SELECT indexdef FROM pg_indexes WHERE indexname='digest_one_send_per_day'")).rows[0]?.indexdef ?? "";
  report(ix.includes("executive"), "one send per day applies to the executive digest only");
  const g = (await db.query("SELECT has_table_privilege('role_admin','app.digest_log','DELETE') AS d, has_table_privilege('role_clinician','app.digest_log','SELECT') AS s")).rows[0];
  report(!g.d && !g.s, "send log still cannot be deleted or read by a clinician");
} finally { await db.end(); }
process.exit(failed ? 1 : 0);
