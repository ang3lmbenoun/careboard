import "dotenv/config";
import { spawn } from "node:child_process";
import pg from "pg";
import { pool, withRole } from "../src/db.js";
import { toolsFor } from "../src/agent.js";
import { patientSchema, medicationSchema, readingSchema } from "../src/entry.js";

// Tests the nurse data-entry role: what it can add, what it can never read or change, and the API guards.
// Usage (from the api folder, after apply_nurse.ts and seeding the demo nurse):  npx tsx scripts/test_nurse.ts
let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, extra = "") => {
  cond ? pass++ : fail++;
  console.log(`${cond ? "PASS" : "FAIL"} ${name}${cond ? "" : "  " + extra}`);
};
const admin_db = new pg.Pool({ connectionString: process.env.ADMIN_DATABASE_URL });
const { rows: users } = await admin_db.query("SELECT id, role, clinic_id FROM app.users");
const pick = (role: string) => {
  const r = users.find((x: any) => x.role === role);
  if (!r) throw new Error(`no ${role} user: run apply_nurse.ts and src/seed.ts first`);
  return { sub: r.id as number, role: role as any, clinicId: r.clinic_id as number | null };
};
const nurse = pick("nurse"), clin = pick("clinician"), exec = pick("executive"), adm = pick("admin");
const otherClinic = nurse.clinicId === 1 ? 2 : 1;

const code = async (sql: string, params: unknown[] = [], u: any = nurse) => {
  try { await withRole(u, (c) => c.query(sql, params)); return "ok"; } catch (e: any) { return e.code as string; }
};
const denied = async (sql: string, params: unknown[] = []) => (await code(sql, params)) === "42501";

// Fixtures read with the admin login.
const seeded = (await admin_db.query("SELECT patient_id FROM clinical.patients WHERE clinic_id = $1 AND NOT demo_created LIMIT 1", [nurse.clinicId])).rows[0].patient_id;
const foreign = (await admin_db.query("SELECT patient_id FROM clinical.patients WHERE clinic_id = $1 LIMIT 1", [otherClinic])).rows[0].patient_id;

// 1. Add a patient in the nurse's own clinic
const NEW = `INSERT INTO clinical.patients (clinic_id, full_name, birth_date, city, primary_condition, diagnosed_on, demo_created, payer)
             VALUES ($1, 'Test Nurse Entry', '1970-05-05', 'Plano', 'Type 2 diabetes', '2018-01-01', $2, 'Medicaid') RETURNING patient_id`;
const mine = await withRole(nurse, async (c) => (await c.query(NEW, [nurse.clinicId, true])).rows[0].patient_id as number);
ok("nurse can add a demo patient in own clinic", Number.isInteger(mine));
const eb = (await admin_db.query("SELECT entered_by FROM clinical.patients WHERE patient_id = $1", [mine])).rows[0].entered_by;
ok("entered_by is set by the database to the nurse", eb === nurse.sub);
ok("nurse cannot add a patient to another clinic", (await code(NEW, [otherClinic, true])) === "42501");
ok("nurse cannot add a non demo patient", (await code(NEW, [nurse.clinicId, false])) === "42501");
ok("nurse cannot forge entered_by", await denied("INSERT INTO clinical.patients (clinic_id, full_name, birth_date, primary_condition, demo_created, payer, entered_by) VALUES ($1,'X Y','1970-01-01','Obesity',true,'Medicaid',999)", [nurse.clinicId]));

// 2. Add a medication and a reading to own demo patient
const MED = "INSERT INTO clinical.patient_medications (patient_id, drug, drug_class, indication, started_on) VALUES ($1,'Metformin','Metformin','Type 2 diabetes','2020-01-01')";
const READ = "INSERT INTO clinical.patient_readings (patient_id, taken_on, a1c, weight_kg) VALUES ($1,'2026-10-01',7.4,82.5)";
ok("nurse can add a medication to own demo patient", (await code(MED, [mine])) === "ok");
ok("nurse can add a reading to own demo patient", (await code(READ, [mine])) === "ok");
ok("nurse cannot add to a seeded (non demo) patient", (await code(MED, [seeded])) === "42501" && (await code(READ, [seeded])) === "42501");
ok("nurse cannot add to another clinic's patient", (await code(MED, [foreign])) === "42501" && (await code(READ, [foreign])) === "42501");
ok("out of range A1C is rejected by the database", (await code("INSERT INTO clinical.patient_readings (patient_id, taken_on, a1c) VALUES ($1,'2026-10-01',25)", [mine])) === "23514");
ok("out of range weight is rejected by the database", (await code("INSERT INTO clinical.patient_readings (patient_id, taken_on, weight_kg) VALUES ($1,'2026-10-01',5)", [mine])) === "23514");

// 3. What the nurse can read
const list = await withRole(nurse, async (c) => (await c.query("SELECT patient_id, clinic_id FROM clinical.patients")).rows);
ok("nurse list contains only own clinic", list.length > 0 && list.every((r: any) => r.clinic_id === nurse.clinicId));
ok("nurse cannot read names", await denied("SELECT full_name FROM clinical.patients"));
ok("nurse cannot read birth dates", await denied("SELECT birth_date FROM clinical.patients"));
ok("nurse cannot read coverage", await denied("SELECT payer FROM clinical.patients"));
ok("nurse cannot SELECT *", await denied("SELECT * FROM clinical.patients"));
ok("nurse cannot read reading values", await denied("SELECT a1c FROM clinical.patient_readings"));
ok("nurse cannot read the entered_by column", await denied("SELECT entered_by FROM clinical.patients"));

// 4. Nothing to change or delete
ok("nurse cannot update a patient", await denied("UPDATE clinical.patients SET city = 'x'"));
ok("nurse cannot delete a patient", await denied("DELETE FROM clinical.patients"));
ok("nurse cannot update or delete medications and readings", (await denied("UPDATE clinical.patient_medications SET drug = 'x'")) && (await denied("DELETE FROM clinical.patient_readings")));

// 5. Everything outside data entry is closed
for (const [what, sql] of [
  ["the care risk worklist", "SELECT * FROM clinical.care_risk"],
  ["aggregate analytics", "SELECT * FROM serving.kpi_demo"],
  ["the audit log", "SELECT * FROM app.audit_log"],
  ["the policy library", "SELECT * FROM app.policy_chunks"],
  ["the user list", "SELECT * FROM app.users"],
  ["control tests", "SELECT * FROM app.control_tests()"],
] as const) ok(`nurse cannot read ${what}`, await denied(sql));
ok("nurse can write an audit entry but not read it", (await code("INSERT INTO app.audit_log (user_id, role, action) VALUES ($1,'nurse','test')", [nurse.sub])) === "ok");

// 6. The nurse agent only has its own tools (the full set of agent tests is in test_handoff.ts)
ok("the nurse agent is shown no analytics tools", toolsFor("nurse").every((t) => ["my_tasks", "draft_handoff"].includes(t.name)));

// 7. Demo housekeeping works without a DELETE right
const old = (await admin_db.query(NEW.replace("$1, $2", "$1, true").replace(/\$2/g, "true"), [nurse.clinicId])).rows[0].patient_id;
await admin_db.query("UPDATE clinical.patients SET created_at = now() - interval '7 hours' WHERE patient_id = $1", [old]);
const removed = await withRole(nurse, async (c) => (await c.query("SELECT clinical.expire_demo_patients() AS n")).rows[0].n);
const still = (await admin_db.query("SELECT patient_id FROM clinical.patients WHERE patient_id = ANY($1)", [[old, mine, seeded]])).rows.map((r: any) => r.patient_id);
ok("housekeeping removes only expired demo patients", removed >= 1 && !still.includes(old) && still.includes(mine) && still.includes(seeded));

// 8. Input validation (the API layer in front of the database)
const good = { full_name: "Marie O'Neil-Smith", birth_date: "1980-02-29", primary_condition: "Obesity", payer: "Commercial" };
ok("valid patient passes validation", patientSchema.safeParse(good).success);
ok("name with digits is rejected", !patientSchema.safeParse({ ...good, full_name: "Bob 123" }).success);
ok("name with markup is rejected", !patientSchema.safeParse({ ...good, full_name: "<script>x</script>" }).success);
ok("future birth date is rejected", !patientSchema.safeParse({ ...good, birth_date: "2999-01-01" }).success);
ok("impossible date is rejected", !patientSchema.safeParse({ ...good, birth_date: "2026-02-31" }).success);
ok("diagnosis before birth is rejected", !patientSchema.safeParse({ ...good, diagnosed_on: "1970-01-01" }).success);
ok("unknown condition is rejected", !patientSchema.safeParse({ ...good, primary_condition: "Flu" }).success);
ok("reading needs a value", !readingSchema.safeParse({ taken_on: "2026-10-01" }).success);
ok("A1C 7.2 passes, 7.25 and 25 fail", readingSchema.safeParse({ taken_on: "2026-10-01", a1c: 7.2 }).success && !readingSchema.safeParse({ taken_on: "2026-10-01", a1c: 7.25 }).success && !readingSchema.safeParse({ taken_on: "2026-10-01", a1c: 25 }).success);
ok("stop date before start is rejected", !medicationSchema.safeParse({ drug: "X1", drug_class: "GLP-1", indication: "Prediabetes", started_on: "2024-01-01", stopped_on: "2023-01-01" }).success);

// 9. Other roles still work: control tests and data checks as admin, care risk as clinician, no patients for executive
const ct = await withRole(adm, async (c) => (await c.query("SELECT * FROM app.control_tests()")).rows);
ok("all control tests still pass", ct.length > 0 && ct.every((r: any) => r.status === "pass"), JSON.stringify(ct[0]));
ok("clinician still reads the care risk view", (await code("SELECT patient_id FROM clinical.care_risk LIMIT 1", [], clin)) === "ok");
ok("executive still cannot read patients", (await code("SELECT patient_id FROM clinical.patients", [], exec)) === "42501");

// 10. HTTP: the route allow list, with a real server on a test port
const PORT = "4599";
const srv = spawn(process.execPath, ["--import", "tsx", "src/server.ts"], { env: { ...process.env, PORT }, stdio: "ignore" });
const base = `http://127.0.0.1:${PORT}`;
for (let i = 0; i < 60; i++) { try { if ((await fetch(base + "/health")).ok) break; } catch { /* waiting */ } await new Promise((r) => setTimeout(r, 500)); }
const login = async (email: string) => {
  const r = await fetch(base + "/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password: process.env.DEMO_PASSWORD }) });
  return r.ok ? ((await r.json()) as any).token as string : "";
};
const get = async (t: string, path: string) => (await fetch(base + path, { headers: { authorization: `Bearer ${t}` } })).status;
const tn = await login("nurse@careboard.dev"), tc = await login("clinician@careboard.dev");
ok("nurse can sign in", !!tn);
const blocked = ["/kpis", "/patients", "/patients/1", "/audit", "/risk/register", "/risk/care/summary", "/agent/ledger", "/agent/kill", "/digest/log", "/eval/latest", "/medicaid/trend", "/catalog"];
const codes = await Promise.all(blocked.map((p) => get(tn, p)));
ok(`nurse gets 403 on ${blocked.length} routes outside data entry`, codes.every((c) => c === 403), codes.join(","));
ok("nurse reaches her own helper (an empty question is a 400, not a 403)", (await fetch(base + "/assistant", { method: "POST", headers: { authorization: `Bearer ${tn}`, "content-type": "application/json" }, body: JSON.stringify({ message: "" }) })).status === 400);
ok("nurse can list entry patients", (await get(tn, "/entry/patients")) === 200);
ok("clinician cannot use data entry routes", (await get(tc, "/entry/patients")) === 403);
const bad = await fetch(base + "/entry/patients", { method: "POST", headers: { authorization: `Bearer ${tn}`, "content-type": "application/json" }, body: JSON.stringify({ full_name: "Bob 123" }) });
ok("API rejects an invalid patient with 400", bad.status === 400);
const made = await fetch(base + "/entry/patients", { method: "POST", headers: { authorization: `Bearer ${tn}`, "content-type": "application/json" }, body: JSON.stringify({ ...good, city: "Plano" }) });
const madeId = made.status === 201 ? ((await made.json()) as any).patient_id : 0;
ok("API adds a valid patient", made.status === 201 && madeId > 0);
const leak = (await admin_db.query("SELECT detail::text AS d FROM app.audit_log WHERE action = 'entry_add_patient' ORDER BY id DESC LIMIT 1")).rows[0]?.d ?? "";
ok("audit entry for the add holds the patient number and no name", leak.includes(String(madeId)) && !/O'Neil|Marie/.test(leak));
srv.kill();

// Clean up what this run created.
await admin_db.query("DELETE FROM clinical.patients WHERE patient_id = ANY($1)", [[mine, madeId].filter(Boolean)]);
console.log(`\n${pass} passed, ${fail} failed`);
await pool.end();
await admin_db.end();
process.exit(fail ? 1 : 0);
