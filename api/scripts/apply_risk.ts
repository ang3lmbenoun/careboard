import "dotenv/config";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import pg from "pg";

// Usage (from the api folder):  npx tsx scripts/apply_risk.ts          -> local database
//                               npx tsx scripts/apply_risk.ts --neon   -> Neon
// Applies db/risk.sql (risk register, control map, care risk view, data-health checks, failed sign-in logging).
// Safe to run more than once. Run scripts/seed_patients.ts first.
const neon = process.argv.includes("--neon");
const adminUrl = neon ? process.env.NEON_ADMIN_URL : process.env.ADMIN_DATABASE_URL;
if (!adminUrl) throw new Error(neon ? "NEON_ADMIN_URL missing in api/.env" : "ADMIN_DATABASE_URL missing in api/.env");

const db = new pg.Client({ connectionString: adminUrl });
await db.connect();
try {
  await db.query("BEGIN");
  await db.query(fs.readFileSync(fileURLToPath(new URL("../../db/risk.sql", import.meta.url)), "utf8"));
  const tests = (await db.query("SELECT name, status FROM app.control_tests()")).rows as { name: string; status: string }[];
  const failed = tests.filter((t) => t.status !== "pass");
  if (failed.length) throw new Error("control tests failed: " + failed.map((t) => t.name).join("; "));
  const risks = (await db.query("SELECT count(*)::int AS n FROM app.risk_register")).rows[0].n;
  await db.query("COMMIT");
  console.log(`risk layer applied: ${risks} risks, ${tests.length} of ${tests.length} control tests pass`, neon ? "(Neon)" : "(local)");
} catch (e) {
  await db.query("ROLLBACK");
  throw e;
} finally {
  await db.end();
}
