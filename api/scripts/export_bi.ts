import "dotenv/config";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import pg from "pg";

// Usage (from the api folder):  npx tsx scripts/export_bi.ts          -> local database
//                               npx tsx scripts/export_bi.ts --neon   -> Neon
// Writes aggregate-only CSV files to bi/data for use in a BI tool (Tableau Public or Power BI).
// Every query runs as role_admin (the API login switches into it), so the database itself refuses patient rows, names and password hashes.
// A second guard refuses to write any file whose columns look like patient identifiers.
const neon = process.argv.includes("--neon");
// Connects as the API login (careboard_api), the same way the app does, then switches into role_admin.
// On Neon the host comes from NEON_ADMIN_URL and the login from careboard_api + NEON_API_PASSWORD.
function connectionUrl(): string {
  if (!neon) {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL missing in api/.env");
    return process.env.DATABASE_URL;
  }
  if (!process.env.NEON_ADMIN_URL || !process.env.NEON_API_PASSWORD) throw new Error("NEON_ADMIN_URL and NEON_API_PASSWORD are needed in api/.env for --neon");
  const u = new URL(process.env.NEON_ADMIN_URL);
  u.username = "careboard_api";
  u.password = process.env.NEON_API_PASSWORD;
  return u.toString();
}
const url = connectionUrl();
const outDir = fileURLToPath(new URL("../../bi/data/", import.meta.url));
fs.mkdirSync(outDir, { recursive: true });

const FORBIDDEN = /^(patient_id|full_name|birth_date|birth_year|city|email|password_hash|user_id)$/i;

const FILES: { name: string; sql: string }[] = [
  {
    name: "dim_date",
    sql: `SELECT d::date AS date,
                 extract(year FROM d)::int AS year,
                 extract(quarter FROM d)::int AS quarter,
                 'Q' || extract(quarter FROM d)::int AS quarter_label,
                 extract(month FROM d)::int AS month_number,
                 to_char(d, 'Mon') AS month_name,
                 date_trunc('month', d)::date AS month_start,
                 date_trunc('week', d)::date AS week_start,
                 extract(isodow FROM d)::int AS weekday_number,
                 to_char(d, 'Dy') AS weekday_name,
                 extract(isodow FROM d) <= 5 AS is_weekday
          FROM generate_series((SELECT min(day) FROM serving.clinic_daily),
                               (SELECT max(day) FROM serving.clinic_daily), interval '1 day') d
          ORDER BY 1`,
  },
  { name: "dim_clinic", sql: `SELECT DISTINCT clinic_id, 'Clinic ' || clinic_id AS clinic_name FROM serving.clinic_daily ORDER BY 1` },
  { name: "dim_department", sql: `SELECT DISTINCT department FROM serving.clinic_daily ORDER BY 1` },
  { name: "dim_drug", sql: `SELECT DISTINCT drug, drug_class FROM serving.medicaid_drug_quarterly ORDER BY 2, 1` },
  { name: "fact_clinic_daily", sql: `SELECT day AS date, clinic_id, department, scheduled, completed, no_shows FROM serving.clinic_daily ORDER BY 1, 2, 3` },
  {
    name: "fact_medicaid_quarterly",
    sql: `SELECT state, year, quarter, drug_class, drug, prescriptions, spend FROM serving.medicaid_drug_quarterly ORDER BY 2, 3, 1, 4, 5`,
  },
  {
    name: "care_risk_summary",
    sql: `SELECT clinic_id, condition, patients, elevated, low, patients_hidden, bands_hidden FROM app.care_risk_summary(5) ORDER BY 1, 2`,
  },
  {
    name: "risk_register",
    sql: `SELECT risk_id, category, title, description, inherent_likelihood, inherent_impact, inherent_score,
                residual_likelihood, residual_impact, residual_score, status, owner, next_step,
                CASE WHEN inherent_score >= 15 THEN 'Critical' WHEN inherent_score >= 10 THEN 'High' WHEN inherent_score >= 5 THEN 'Medium' ELSE 'Low' END AS inherent_band,
                CASE WHEN residual_score >= 15 THEN 'Critical' WHEN residual_score >= 10 THEN 'High' WHEN residual_score >= 5 THEN 'Medium' ELSE 'Low' END AS residual_band
         FROM app.risk_register ORDER BY risk_id`,
  },
  { name: "control_map", sql: `SELECT control_id, name, safeguard_type, hipaa_ref, how_implemented, status, how_to_verify FROM app.control_map ORDER BY control_id` },
  { name: "risk_control_bridge", sql: `SELECT risk_id, unnest(controls) AS control_id FROM app.risk_register ORDER BY 1, 2` },
  { name: "data_classification", sql: `SELECT object_schema, object_name, column_name, label FROM app.data_classification ORDER BY 1, 2, 3` },
  {
    name: "assumptions",
    sql: `SELECT * FROM (VALUES
            ('visit_value_usd', '150', 'Assumed average value of one completed visit. Not from billing. Change it to test revenue at risk.'),
            ('target_no_show_rate', '0.10', 'Working target. Avoidable loss counts only no-shows above this rate.'),
            ('min_cell_size', '5', 'Patient counts below this are hidden by the database.'),
            ('data_note_medicaid', 'CMS State Drug Utilization Data 2024', 'Four drug classes. SGLT2 inhibitors not included. Small cells may be suppressed in the source.'),
            ('data_note_synthetic', 'Synthetic', 'Clinic activity, patients and risk scores are invented for this project.')
          ) AS t(name, value, note)`,
  },
];

const cell = (v: unknown): string => {
  if (v === null || v === undefined) return "";
  const s = v instanceof Date ? v.toISOString().slice(0, 10) : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

const db = new pg.Client({ connectionString: url });
await db.connect();
try {
  await db.query("BEGIN READ ONLY");
  await db.query("SET LOCAL ROLE role_admin");
  const manifest: string[] = ["file,rows"];
  for (const f of FILES) {
    const r = await db.query({ text: f.sql, rowMode: "array" });
    const cols = r.fields.map((x) => x.name);
    const bad = cols.filter((c) => FORBIDDEN.test(c));
    if (bad.length) throw new Error(`${f.name}: refusing to export identifier columns: ${bad.join(", ")}`);
    const lines = [cols.join(","), ...r.rows.map((row: unknown[]) => row.map(cell).join(","))];
    fs.writeFileSync(outDir + f.name + ".csv", lines.join("\n") + "\n", "utf8");
    manifest.push(`${f.name}.csv,${r.rowCount}`);
    console.log(`${f.name}.csv`.padEnd(32), String(r.rowCount).padStart(7), "rows");
  }
  fs.writeFileSync(outDir + "_manifest.csv", manifest.join("\n") + "\n", "utf8");
  await db.query("ROLLBACK");
  console.log("done:", outDir, neon ? "(Neon)" : "(local)");
} finally {
  await db.end();
}
