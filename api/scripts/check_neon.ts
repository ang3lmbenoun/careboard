import "dotenv/config";
import pg from "pg";

const u = new URL(process.env.NEON_ADMIN_URL!);
u.username = "careboard_api";
u.password = process.env.NEON_API_PASSWORD!;
u.hostname = u.hostname.replace("-pooler", "");
u.searchParams.delete("channel_binding");
const pool = new pg.Pool({ connectionString: u.toString() });

async function run(label: string, role: string | null, clinic: string | null, sql: string) {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    if (role) await c.query(`SET LOCAL ROLE ${role}`);
    if (clinic) await c.query("SELECT set_config('app.clinic_id', $1, true)", [clinic]);
    const r = await c.query(sql);
    console.log(label, "->", JSON.stringify(r.rows));
  } catch (e: any) {
    console.log(label, "-> DENIED:", e.message);
  } finally {
    await c.query("ROLLBACK");
    c.release();
  }
}

const n = "SELECT count(*)::int AS n FROM clinical.patients";
await run("attributes", null, null,
  "SELECT rolname, rolsuper, rolbypassrls, rolinherit FROM pg_roles WHERE rolname IN ('careboard_api','role_admin','role_clinician','role_executive') ORDER BY 1");
await run("clinician clinic 1", "role_clinician", "1", n);
await run("clinician clinic 2", "role_clinician", "2", n);
await run("clinician no clinic", "role_clinician", null, n);
await run("clinician full_name", "role_clinician", "1", "SELECT full_name FROM clinical.patients");
await run("executive patients", "role_executive", null, n);
await run("admin patients", "role_admin", null, n);
await run("executive serving", "role_executive", null, "SELECT count(*)::int AS n FROM serving.kpi_demo");
   await run("executive medicaid", "role_executive", null, "SELECT count(*)::int AS n, round(sum(spend))::float8 AS spend FROM serving.medicaid_drug_quarterly");
   await run("executive clinic_daily", "role_executive", null, "SELECT count(*)::int AS n, sum(scheduled)::int AS scheduled FROM serving.clinic_daily");
await pool.end();