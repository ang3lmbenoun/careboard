import "dotenv/config";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { parse } from "csv-parse/sync";

type Spec = { file: string; table: string; ddl: string; cols: string[]; types: string[] };

const specs: Spec[] = [
  {
    file: "medicaid_drug_quarterly.csv",
    table: "serving.medicaid_drug_quarterly",
    ddl: `CREATE TABLE IF NOT EXISTS serving.medicaid_drug_quarterly (
      state text NOT NULL, year int NOT NULL, quarter int NOT NULL,
      drug_class text NOT NULL, drug text NOT NULL,
      prescriptions numeric, spend numeric,
      PRIMARY KEY (state, year, quarter, drug_class, drug))`,
    cols: ["state", "year", "quarter", "drug_class", "drug", "prescriptions", "spend"],
    types: ["text", "int", "int", "text", "text", "numeric", "numeric"],
  },
  {
    file: "clinic_daily.csv",
    table: "serving.clinic_daily",
    ddl: `CREATE TABLE IF NOT EXISTS serving.clinic_daily (
      day date NOT NULL, clinic_id int NOT NULL, department text NOT NULL,
      scheduled int NOT NULL, completed int NOT NULL, no_shows int NOT NULL,
      PRIMARY KEY (day, clinic_id, department))`,
    cols: ["date", "clinic_id", "department", "scheduled", "completed", "no_shows"],
    types: ["date", "int", "text", "int", "int", "int"],
  },
];

   const pool = new pg.Pool({
     connectionString: process.argv.includes("--neon") ? process.env.NEON_ADMIN_URL : process.env.ADMIN_DATABASE_URL,
   });
const c = await pool.connect();
try {
  await c.query("BEGIN");
  for (const s of specs) {
    const file = fileURLToPath(new URL(`../../data/${s.file}`, import.meta.url));
    const rows = parse(fs.readFileSync(file, "utf8"), {
      columns: true,
      skip_empty_lines: true,
    }) as Record<string, string>[];
    const arrays = s.cols.map((k) => rows.map((r) => (r[k] === "" ? null : r[k])));
    const placeholders = s.types.map((t, i) => `$${i + 1}::${t}[]`).join(", ");

    await c.query(s.ddl);
    await c.query(`GRANT SELECT ON ${s.table} TO role_admin, role_clinician, role_executive`);
    // The assistant role exists only after scripts/apply_assistant.ts has run; keep its grants when tables are reloaded.
    await c.query(`DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'role_assistant') THEN GRANT SELECT ON ${s.table} TO role_assistant; END IF; END $$`);
    await c.query(`TRUNCATE ${s.table}`);
    await c.query(`INSERT INTO ${s.table} SELECT * FROM unnest(${placeholders})`, arrays);
    console.log("loaded", rows.length, "rows into", s.table);
  }

     const comments = fs.readFileSync(fileURLToPath(new URL("../../db/comments.sql", import.meta.url)), "utf8");
   await c.query(comments);
  await c.query("COMMIT");
} catch (e) {
  await c.query("ROLLBACK");
  throw e;
} finally {
  c.release();
  await pool.end();
}