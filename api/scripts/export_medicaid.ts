   import "dotenv/config";
   import fs from "node:fs";
   import path from "node:path";
   import { fileURLToPath } from "node:url";
   import pg from "pg";

   const src = new pg.Client({
     host: process.env.SRC_HOST,
     port: Number(process.env.SRC_PORT),
     database: process.env.SRC_NAME,
     user: process.env.SRC_USER,
     password: process.env.SRC_PASSWORD,
   });
   await src.connect();

   const { rows } = await src.query(`
     SELECT state, year, quarter, drug_class, drug,
            SUM(number_of_prescriptions)::float8 AS prescriptions,
            SUM(total_amount_reimbursed)::float8 AS spend
     FROM analytics.fct_glp1_utilization
     GROUP BY state, year, quarter, drug_class, drug
     ORDER BY state, year, quarter, drug_class, drug`);

   const ref = await src.query(
     "SELECT SUM(total_spend)::float8 AS s FROM analytics.diabetes_class_summary"
   );
   await src.end();

   const cols = ["state", "year", "quarter", "drug_class", "drug", "prescriptions", "spend"];
   const esc = (v: unknown) => `"${String(v ?? "").replaceAll('"', '""')}"`;
   const csv = [cols.join(","), ...rows.map((r) => cols.map((c) => esc(r[c])).join(","))].join("\n");

   const out = fileURLToPath(new URL("../../data/medicaid_drug_quarterly.csv", import.meta.url));
   fs.mkdirSync(path.dirname(out), { recursive: true });
   fs.writeFileSync(out, csv + "\n");

   const total = rows.reduce((a, r) => a + (r.spend ?? 0), 0);
   console.log("rows:", rows.length);
   console.log("total spend:", Math.round(total));
   console.log("class summary total:", Math.round(ref.rows[0].s));
   console.log("match:", Math.abs(total - ref.rows[0].s) < 1 ? "yes" : "NO");
   console.log("written to:", out);