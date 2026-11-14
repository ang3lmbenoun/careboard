import "dotenv/config";
import pg from "pg";

// One-off cleanup for the LOCAL database only: removes the "Check Person" demo patients that older runs of
// test_handoff.ts left behind, plus their record_checks. Nothing else is touched.
// Usage (api folder):  npx tsx scripts/cleanup_test_patients.ts          (lists what it would delete)
//                      npx tsx scripts/cleanup_test_patients.ts --yes    (deletes it)
const url = process.env.ADMIN_DATABASE_URL ?? "";
if (!url) { console.error("ADMIN_DATABASE_URL is not set. Nothing done."); process.exit(1); }
if (/neon\.tech/i.test(url)) { console.error("Refusing to run: ADMIN_DATABASE_URL points at Neon. This script is for the local database only."); process.exit(1); }

const confirmed = process.argv.includes("--yes");
const db = new pg.Pool({ connectionString: url });
const WHERE = "full_name = 'Check Person' AND demo_created = true";
try {
  const { rows } = await db.query(
    `SELECT p.patient_id, p.clinic_id, p.created_at,
            (SELECT count(*)::int FROM app.record_checks r WHERE r.patient_id = p.patient_id) AS record_checks
       FROM clinical.patients p WHERE ${WHERE} ORDER BY p.patient_id`
  );
  if (!rows.length) { console.log("No matching patients. Nothing to delete."); }
  else {
    console.log(`${rows.length} patient(s) match (full_name = 'Check Person' and demo_created = true):`);
    console.table(rows);
    if (!confirmed) console.log("\nNothing deleted. To delete these rows and their record_checks, run again with --yes.");
    else {
      const ids = rows.map((r: any) => r.patient_id as number);
      const c = await db.connect();
      try {
        await c.query("BEGIN");
        const rc = await c.query("DELETE FROM app.record_checks WHERE patient_id = ANY($1::int[])", [ids]);
        const pt = await c.query(`DELETE FROM clinical.patients WHERE patient_id = ANY($1::int[]) AND ${WHERE}`, [ids]);
        await c.query("COMMIT");
        console.log(`Deleted ${pt.rowCount} patient(s) and ${rc.rowCount} record check(s).`);
      } catch (e) { await c.query("ROLLBACK"); throw e; } finally { c.release(); }
    }
  }
} finally {
  await db.end();
}
