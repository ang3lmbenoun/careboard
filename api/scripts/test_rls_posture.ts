// The posture that keeps row-level security from being bypassed, checked directly in the catalog.
// FORCE ROW LEVEL SECURITY is deliberately not used: the aggregate functions (for example app.care_risk_summary) are
// SECURITY DEFINER and read across clinics as the table owner so executives can see counts. With FORCE they return nothing.
// The protection is that the API login cannot reach the owner's privileges at all, and this test proves it.
import "dotenv/config";
import pg from "pg";
const neon = process.argv.includes("--neon");
const db = new pg.Pool({ connectionString: neon ? process.env.NEON_ADMIN_URL : process.env.ADMIN_DATABASE_URL });   // --neon checks production (read-only queries)
let pass = 0, fail = 0;
const ok = (n: string, c: boolean) => { c ? pass++ : fail++; console.log(`${c ? "PASS" : "FAIL"} ${n}`); };
const one = async (sql: string, p: unknown[] = []) => (await db.query(sql, p)).rows[0];

const api = await one("SELECT rolsuper, rolbypassrls, rolinherit, rolcreaterole, rolcreatedb FROM pg_roles WHERE rolname = 'careboard_api'");
ok("the API login is not a superuser and cannot bypass row-level security", api && !api.rolsuper && !api.rolbypassrls);
ok("the API login inherits nothing, cannot create roles or databases", api && !api.rolinherit && !api.rolcreaterole && !api.rolcreatedb);

const owners = (await db.query(`SELECT DISTINCT pg_get_userbyid(c.relowner) AS owner FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname IN ('app','clinical') AND c.relkind = 'r'`)).rows.map((r) => r.owner as string);
const memberOfOwner = (await Promise.all(owners.map(async (o) => (await one("SELECT pg_has_role('careboard_api', $1, 'USAGE') AS m", [o])).m))).some(Boolean);
ok("the API login is not a member of any table owner role", owners.length > 0 && !memberOfOwner);

const groups = ["role_admin", "role_clinician", "role_executive", "role_nurse"];
const g = (await db.query("SELECT rolname, rolsuper, rolbypassrls, rolcanlogin FROM pg_roles WHERE rolname = ANY($1)", [groups])).rows;
ok("the four group roles exist and none can log in, bypass row-level security or is a superuser", g.length === 4 && g.every((r) => !r.rolcanlogin && !r.rolbypassrls && !r.rolsuper));

const unprotected = (await db.query(`SELECT n.nspname || '.' || c.relname AS t FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE c.relkind = 'r' AND n.nspname = 'clinical' AND NOT c.relrowsecurity AND c.relname NOT IN ('stock_items')`)).rows.map((r) => r.t);
ok(`every table in the clinical schema has row-level security on${unprotected.length ? " (missing: " + unprotected.join(", ") + ")" : ""}`, unprotected.length === 0);

const definer = (await db.query(`SELECT p.proname, p.proconfig FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE p.prosecdef AND n.nspname IN ('app','clinical','serving')`)).rows;
const unsafe = definer.filter((r) => !(r.proconfig ?? []).some((c: string) => c.startsWith("search_path=")));
ok(`every SECURITY DEFINER function pins its search_path${unsafe.length ? " (missing: " + unsafe.map((r) => r.proname).join(", ") + ")" : ""}`, unsafe.length === 0);

console.log(`\n${pass} passed, ${fail} failed`);
await db.end();
process.exit(fail ? 1 : 0);
