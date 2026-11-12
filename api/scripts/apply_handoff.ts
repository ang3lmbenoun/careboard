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
  const tbl = async (schema: string, t: string) => (await db.query("SELECT 1 FROM information_schema.tables WHERE table_schema=$1 AND table_name=$2", [schema, t])).rowCount === 1;
  report((await tbl("app", "messages")) && (await tbl("app", "record_checks")) && (await tbl("clinical", "stock_items")) && (await tbl("clinical", "stock_counts")), "messages, record checks and stock tables exist");
  const fn = (await db.query("SELECT count(*)::int AS n FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname='app' AND p.proname IN ('clinic_contacts','can_message')")).rows[0].n;
  report(fn === 2, "contact and message-permission functions exist");
  const rls = (await db.query("SELECT count(*)::int AS n FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relrowsecurity AND ((n.nspname='app' AND c.relname IN ('messages','record_checks')) OR (n.nspname='clinical' AND c.relname = 'stock_counts'))")).rows[0].n;
  report(rls === 3, "row-level security is on for messages, record checks and stock counts");
  const p = (await db.query(`SELECT has_column_privilege('role_nurse','app.messages','body','INSERT') AS n_msg, has_table_privilege('role_nurse','app.messages','DELETE') AS n_del,
      has_column_privilege('role_nurse','clinical.stock_counts','quantity','INSERT') AS n_cnt, has_column_privilege('role_clinician','clinical.stock_counts','quantity','INSERT') AS c_cnt,
      has_table_privilege('role_executive','app.messages','SELECT') AS x_msg, has_table_privilege('role_admin','app.messages','SELECT') AS a_msg`)).rows[0];
  report(p.n_msg && !p.n_del, "a nurse can send but never delete messages");
  report(p.n_cnt && !p.c_cnt, "only a nurse can enter a stock count");
  report(!p.x_msg && !p.a_msg, "executives and administrators cannot read messages");
  const pol = (await db.query("SELECT policyname, qual FROM pg_policies WHERE schemaname='app' AND policyname IN ('runs_admin_read','actions_admin_read')")).rows;
  report(pol.length === 2 && pol.every((r: any) => /nurse|handoff_message/.test(r.qual)), "administrators cannot read nurse runs or message drafts");
} finally { await db.end(); }
process.exit(failed ? 1 : 0);
