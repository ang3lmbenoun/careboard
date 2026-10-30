import "dotenv/config";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { pool, withAssistant } from "../src/db.js";

// Usage (from the api folder):  npx tsx scripts/apply_assistant.ts          -> local database
//                               npx tsx scripts/apply_assistant.ts --neon   -> Neon
const neon = process.argv.includes("--neon");
const adminUrl = neon ? process.env.NEON_ADMIN_URL : process.env.ADMIN_DATABASE_URL;
if (!adminUrl) throw new Error(neon ? "NEON_ADMIN_URL missing in api/.env" : "ADMIN_DATABASE_URL missing in api/.env");

const admin = new pg.Pool({ connectionString: adminUrl });
try {
  const sql = fs.readFileSync(fileURLToPath(new URL("../../db/assistant.sql", import.meta.url)), "utf8");
  await admin.query(sql);
  console.log("applied db/assistant.sql to", neon ? "Neon" : "local database");
} finally {
  await admin.end();
}

let failed = 0;
const report = (ok: boolean, label: string) => {
  console.log(ok ? "PASS" : "FAIL", label);
  if (!ok) failed++;
};

async function canRead(label: string, table: string) {
  try {
    const n = await withAssistant(async (c) => Number((await c.query(`SELECT count(*) AS n FROM ${table}`)).rows[0].n));
    report(n > 0, `${label} readable (${n} rows)`);
  } catch (e: any) {
    report(false, `${label} readable (${e.message})`);
  }
}

async function mustBeDenied(label: string, sql: string) {
  try {
    await withAssistant((c) => c.query(sql));
    report(false, `${label} must be denied but succeeded`);
  } catch (e: any) {
    report(e.code === "42501" || e.code === "25006", `${label} denied (${e.code})`);
  }
}

await canRead("serving.medicaid_drug_quarterly", "serving.medicaid_drug_quarterly");
await canRead("serving.clinic_daily", "serving.clinic_daily");
await mustBeDenied("clinical.patients", "SELECT * FROM clinical.patients");
await mustBeDenied("app.users", "SELECT * FROM app.users");
await mustBeDenied("app.audit_log", "SELECT * FROM app.audit_log");
await mustBeDenied("serving.kpi_demo", "SELECT * FROM serving.kpi_demo");
await mustBeDenied("INSERT into clinic_daily", "INSERT INTO serving.clinic_daily VALUES ('2030-01-01', 1, 'x', 1, 1, 0)");
await mustBeDenied("DELETE from clinic_daily", "DELETE FROM serving.clinic_daily");

await pool.end();
console.log(failed === 0 ? "ALL CHECKS PASSED" : `${failed} CHECK(S) FAILED`);
process.exit(failed === 0 ? 0 : 1);
