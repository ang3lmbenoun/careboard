import "dotenv/config";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { generatePatient, seeded } from "../src/patientGen.js";

// Usage (from the api folder):  npx tsx scripts/seed_patients.ts          -> local database
//                               npx tsx scripts/seed_patients.ts --neon   -> Neon
// Applies db/patients.sql, then replaces the seed patients with 48 synthetic ones (24 per clinic).
// Patients added through the demo button are left alone.
const neon = process.argv.includes("--neon");
const adminUrl = neon ? process.env.NEON_ADMIN_URL : process.env.ADMIN_DATABASE_URL;
if (!adminUrl) throw new Error(neon ? "NEON_ADMIN_URL missing in api/.env" : "ADMIN_DATABASE_URL missing in api/.env");

const db = new pg.Client({ connectionString: adminUrl });
await db.connect();
try {
  await db.query("BEGIN");
  await db.query(fs.readFileSync(fileURLToPath(new URL("../../db/patients.sql", import.meta.url)), "utf8"));
  await db.query("DELETE FROM clinical.patients WHERE NOT demo_created");

  const rand = seeded(42);
  const today = Date.UTC(2026, 9, 28);
  let meds = 0;
  let readings = 0;
  for (const clinic of [1, 2]) {
    for (let i = 0; i < 24; i++) {
      const p = generatePatient(rand, today);
      const { rows } = await db.query(
        `INSERT INTO clinical.patients (clinic_id, full_name, birth_date, city, primary_condition, diagnosed_on)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING patient_id`,
        [clinic, p.full_name, p.birth_date, p.city, p.primary_condition, p.diagnosed_on]
      );
      const id = rows[0].patient_id;
      for (const m of p.meds) {
        await db.query(
          `INSERT INTO clinical.patient_medications (patient_id, drug, drug_class, indication, started_on, stopped_on, stop_reason)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [id, m.drug, m.drug_class, m.indication, m.started_on, m.stopped_on, m.stop_reason]
        );
        meds++;
      }
      for (const r of p.readings) {
        await db.query("INSERT INTO clinical.patient_readings (patient_id, taken_on, a1c, weight_kg) VALUES ($1,$2,$3,$4)", [id, r.taken_on, r.a1c, r.weight_kg]);
        readings++;
      }
    }
  }
  await db.query("COMMIT");
  console.log(`seeded 48 patients, ${meds} medication courses, ${readings} readings`, neon ? "(Neon)" : "(local)");
} catch (e) {
  await db.query("ROLLBACK");
  throw e;
} finally {
  await db.end();
}
