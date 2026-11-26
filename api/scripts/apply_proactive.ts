import "dotenv/config";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import pg from "pg";

// Usage (from the api folder):  npx tsx scripts/apply_proactive.ts          -> local database
//                               npx tsx scripts/apply_proactive.ts --neon   -> Neon
// Applies db/proactive.sql (scheduled review columns) and checks the result. Run it BEFORE deploying code that uses it.
const neon = process.argv.includes("--neon");
const adminUrl = neon ? process.env.NEON_ADMIN_URL : process.env.ADMIN_DATABASE_URL;
if (!adminUrl) throw new Error(neon ? "NEON_ADMIN_URL missing in api/.env" : "ADMIN_DATABASE_URL missing in api/.env");
const db = new pg.Pool({ connectionString: adminUrl });
let failed = 0;
const report = (ok: boolean, label: string) => { console.log(ok ? "PASS" : "FAIL", label); if (!ok) failed++; };
try {
  await db.query(fs.readFileSync(fileURLToPath(new URL("../../db/proactive.sql", import.meta.url)), "utf8"));
  console.log("applied db/proactive.sql to", neon ? "Neon" : "local database");
  const cols = (await db.query("SELECT column_name FROM information_schema.columns WHERE table_schema='app' AND table_name='agent_actions' AND column_name IN ('origin','outcome_checked_at','outcome_detail')")).rowCount;
  report(cols === 3, "agent_actions has origin, outcome_checked_at and outcome_detail");
  const g = (await db.query(`SELECT has_column_privilege('role_clinician','app.agent_actions','outcome_detail','UPDATE') AS c_upd,
      has_column_privilege('role_clinician','app.agent_actions','origin','UPDATE') AS c_origin,
      has_column_privilege('role_executive','app.agent_actions','outcome_detail','UPDATE') AS e_upd,
      has_table_privilege('role_clinician','app.agent_actions','DELETE') AS c_del`)).rows[0];
  report(g.c_upd, "a clinician can record the outcome check");
  report(!g.c_origin && !g.e_upd && !g.c_del, "nobody can change the origin, and nobody can delete actions");
  const d = (await db.query("SELECT column_default FROM information_schema.columns WHERE table_schema='app' AND table_name='agent_actions' AND column_name='origin'")).rows[0];
  report(String(d?.column_default).includes("user"), "existing and chat-made actions default to origin user");
} finally { await db.end(); }
process.exit(failed ? 1 : 0);
