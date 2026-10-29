   import "dotenv/config";
   import fs from "node:fs";
   import { fileURLToPath } from "node:url";
   import pg from "pg";
   import { parse } from "csv-parse/sync";

   const file = fileURLToPath(new URL("../../data/medicaid_drug_quarterly.csv", import.meta.url));
   const rows = parse(fs.readFileSync(file, "utf8"), {
     columns: true,
     skip_empty_lines: true,
   }) as Record<string, string>[];

   const col = (k: string) => rows.map((r) => (r[k] === "" ? null : r[k]));

   const pool = new pg.Pool({ connectionString: process.env.ADMIN_DATABASE_URL });
   const c = await pool.connect();
   try {
     await c.query("BEGIN");
     await c.query(`
       CREATE TABLE IF NOT EXISTS serving.medicaid_drug_quarterly (
         state text NOT NULL,
         year int NOT NULL,
         quarter int NOT NULL,
         drug_class text NOT NULL,
         drug text NOT NULL,
         prescriptions numeric,
         spend numeric,
         PRIMARY KEY (state, year, quarter, drug_class, drug)
       )`);
     await c.query("GRANT SELECT ON serving.medicaid_drug_quarterly TO role_admin, role_clinician, role_executive");
     await c.query("TRUNCATE serving.medicaid_drug_quarterly");
     await c.query(
       `INSERT INTO serving.medicaid_drug_quarterly
        SELECT * FROM unnest($1::text[], $2::int[], $3::int[], $4::text[], $5::text[], $6::numeric[], $7::numeric[])`,
       [col("state"), col("year"), col("quarter"), col("drug_class"), col("drug"), col("prescriptions"), col("spend")]
     );
     await c.query("COMMIT");
     console.log("loaded", rows.length, "rows");
   } catch (e) {
     await c.query("ROLLBACK");
     throw e;
   } finally {
     c.release();
     await pool.end();
   }