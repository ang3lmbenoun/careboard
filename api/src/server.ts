   import { fileURLToPath } from "node:url";
   import "dotenv/config";
   import express from "express";
   import bcrypt from "bcryptjs";
   import jwt from "jsonwebtoken";
   import { pool, withRole, type Role } from "./db.js";
   import helmet from "helmet";
   import rateLimit from "express-rate-limit";
import { registerAssistant } from "./assistant.js";
import { generatePatient } from "./patientGen.js";

   const SECRET = process.env.JWT_SECRET;
   if (!SECRET) throw new Error("JWT_SECRET missing in api/.env");

   type Claims = { sub: number; role: Role; clinicId: number | null };

   const app = express();
   app.use(express.json());
        app.set("trust proxy", 1); // Render sits behind a proxy; needed so the limiter sees real client IPs
     app.use(helmet());
     const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: "draft-7", legacyHeaders: false });
        // The browser calls /api/...; strip the prefix so routes stay at the root (the Vite proxy does the same in dev).
     app.use((req, _res, next) => {
       if (req.url.startsWith("/api/")) req.url = req.url.slice(4);
       next();
     });

   async function audit(u: Claims, action: string, detail: object = {}) {
     await withRole(u, (c) =>
       c.query(
         "INSERT INTO app.audit_log (user_id, role, action, detail) VALUES ($1, $2, $3, $4)",
         [u.sub, u.role, action, detail]
       )
     );
   }

   function auth(req: any, res: any, next: any) {
     const token = (req.headers.authorization ?? "").replace(/^Bearer /, "");
     try {
       req.user = jwt.verify(token, SECRET!) as unknown as Claims;
       next();
     } catch {
       res.status(401).json({ error: "unauthorized" });
     }
   }

   // Run a query as the caller's role. The database decides; 42501 = permission denied.
      async function guarded(req: any, res: any, action: string, sql: string, params: unknown[] = []) {
     try {
       const rows = await withRole(req.user, async (c) =>    (await c.query(sql, params)).rows);
       await audit(req.user, action, { rows: rows.length });
       res.json(rows);
     } catch (e: any) {
       if (e.code === "42501") return res.status(403).json({ error: "forbidden" });
       console.error(e);
       res.status(500).json({ error: "server error" });
     }
   }

    app.post("/auth/login", loginLimiter, async (req, res) => {
     const { email, password } = req.body ?? {};
     if (typeof email !== "string" || typeof password !== "string")
       return res.status(400).json({ error: "email and password required" });
     const { rows } = await pool.query(
       "SELECT id, display_name, password_hash, role, clinic_id FROM app.users WHERE email = $1",
       [email.toLowerCase()]
     );
     const u = rows[0];
     if (!u || !(await bcrypt.compare(password, u.password_hash)))
       return res.status(401).json({ error: "invalid credentials" });
     const claims: Claims = { sub: u.id, role: u.role, clinicId: u.clinic_id };
     const token = jwt.sign(claims, SECRET, { expiresIn: "8h" });
     await audit(claims, "login");
     res.json({ token, user: { name: u.display_name, role: u.role } });
   });

   app.get("/me", auth, (req: any, res) => res.json(req.user));
   app.get("/kpis", auth, (req, res) =>
  guarded(req, res, "view_kpis", "SELECT metric, period::text AS period, value::float8 AS value FROM serving.kpi_demo ORDER BY metric, period"));
   const addLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: 12, standardHeaders: "draft-7", legacyHeaders: false });
   const removeLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: 40, standardHeaders: "draft-7", legacyHeaders: false });
   const patientId = (v: unknown) => {
     const n = Number(v);
     return Number.isInteger(n) && n > 0 ? n : null;
   };

   app.get("/patients", auth, (req, res) =>
     guarded(
       req, res, "view_patients",
       `SELECT p.patient_id, p.clinic_id, p.birth_year, p.city, p.primary_condition,
               p.diagnosed_on::text AS diagnosed_on, p.demo_created,
               COALESCE((SELECT array_agg(DISTINCT m.drug_class ORDER BY m.drug_class)
                         FROM clinical.patient_medications m
                         WHERE m.patient_id = p.patient_id AND m.stopped_on IS NULL), '{}') AS current_classes
        FROM clinical.patients p ORDER BY p.patient_id`
     ));

   // Patients now taking each drug class, among the patients the caller may see.
   app.get("/patients/classes", auth, (req, res) =>
     guarded(
       req, res, "view_patient_classes",
       `SELECT m.drug_class, m.indication, count(DISTINCT m.patient_id)::int AS patients
        FROM clinical.patient_medications m WHERE m.stopped_on IS NULL
        GROUP BY 1, 2 ORDER BY 1, 2`
     ));

   app.get("/patients/:id", auth, async (req: any, res) => {
     const id = patientId(req.params.id);
     if (!id) return res.status(400).json({ error: "bad id" });
     try {
       const out = await withRole(req.user, async (c) => {
         const p = (
           await c.query(
             `SELECT patient_id, clinic_id, birth_year, city, primary_condition, diagnosed_on::text AS diagnosed_on, demo_created
              FROM clinical.patients WHERE patient_id = $1`,
             [id]
           )
         ).rows[0];
         if (!p) return null;
         const medications = (
           await c.query(
             `SELECT med_id, drug, drug_class, indication, started_on::text AS started_on, stopped_on::text AS stopped_on, stop_reason
              FROM clinical.patient_medications WHERE patient_id = $1 ORDER BY started_on, med_id`,
             [id]
           )
         ).rows;
         const readings = (
           await c.query(
             `SELECT taken_on::text AS taken_on, a1c::float8 AS a1c, weight_kg::float8 AS weight_kg
              FROM clinical.patient_readings WHERE patient_id = $1 ORDER BY taken_on`,
             [id]
           )
         ).rows;
         return { ...p, medications, readings };
       });
       if (!out) return res.status(404).json({ error: "not found" });
       await audit(req.user, "view_patient", { patient_id: id });
       res.json(out);
     } catch (e: any) {
       if (e.code === "42501") return res.status(403).json({ error: "forbidden" });
       console.error(e);
       res.status(500).json({ error: "server error" });
     }
   });

   // Demo only: creates one random synthetic patient in the caller's clinic. No free text is accepted.
   app.post("/patients/generate", auth, addLimiter, async (req: any, res) => {
     if (req.user.role !== "clinician" || req.user.clinicId == null) return res.status(403).json({ error: "forbidden" });
     const p = generatePatient(Math.random, Date.now());
     try {
       const id = await withRole(req.user, async (c) => {
         // Housekeeping: demo patients expire after six hours so the cap never fills up for good.
         await c.query("DELETE FROM clinical.patients WHERE demo_created AND created_at < now() - interval '6 hours'");
         const r = await c.query(
           `INSERT INTO clinical.patients (clinic_id, full_name, birth_date, city, primary_condition, diagnosed_on, demo_created)
            VALUES ($1, $2, $3, $4, $5, $6, true) RETURNING patient_id`,
           [req.user.clinicId, p.full_name, p.birth_date, p.city, p.primary_condition, p.diagnosed_on]
         );
         const pid = r.rows[0].patient_id;
         await c.query(
           `INSERT INTO clinical.patient_medications (patient_id, drug, drug_class, indication, started_on, stopped_on, stop_reason)
            SELECT $1, * FROM unnest($2::text[], $3::text[], $4::text[], $5::date[], $6::date[], $7::text[])`,
           [pid, p.meds.map((m) => m.drug), p.meds.map((m) => m.drug_class), p.meds.map((m) => m.indication),
            p.meds.map((m) => m.started_on), p.meds.map((m) => m.stopped_on), p.meds.map((m) => m.stop_reason)]
         );
         await c.query(
           `INSERT INTO clinical.patient_readings (patient_id, taken_on, a1c, weight_kg)
            SELECT $1, * FROM unnest($2::date[], $3::numeric[], $4::numeric[])`,
           [pid, p.readings.map((x) => x.taken_on), p.readings.map((x) => x.a1c), p.readings.map((x) => x.weight_kg)]
         );
         return pid as number;
       });
       await audit(req.user, "add_patient", { patient_id: id });
       res.status(201).json({ patient_id: id });
     } catch (e: any) {
       if (e.code === "CB001") return res.status(409).json({ error: "limit" });
       if (e.code === "42501") return res.status(403).json({ error: "forbidden" });
       console.error(e);
       res.status(500).json({ error: "server error" });
     }
   });

   // Only patients added through the demo button can be removed; the database enforces this.
   app.delete("/patients/:id", auth, removeLimiter, async (req: any, res) => {
     const id = patientId(req.params.id);
     if (!id) return res.status(400).json({ error: "bad id" });
     if (req.user.role !== "clinician") return res.status(403).json({ error: "forbidden" });
     try {
       const n = await withRole(req.user, async (c) =>
         (await c.query("DELETE FROM clinical.patients WHERE patient_id = $1 AND demo_created", [id])).rowCount
       );
       if (!n) return res.status(404).json({ error: "not removable" });
       await audit(req.user, "remove_patient", { patient_id: id });
       res.json({ ok: true });
     } catch (e: any) {
       if (e.code === "42501") return res.status(403).json({ error: "forbidden" });
       console.error(e);
       res.status(500).json({ error: "server error" });
     }
   });
   app.get("/audit", auth, (req, res) =>
     guarded(req, res, "view_audit", "SELECT a.id, a.at, COALESCE(u.display_name, 'Unknown user') AS who, a.role, a.action, a.detail FROM app.audit_log a LEFT JOIN app.users u ON u.id = a.user_id ORDER BY a.id DESC LIMIT 50"));

   const DIMS: Record<string, string> = { class: "drug_class", drug: "drug", state: "state" };
   const strOrNull = (v: unknown) => (typeof v === "string" && v !== "" ? v : null);
   const FILTER = "WHERE ($1::text IS NULL OR drug_class = $1) AND ($2::text IS NULL OR drug = $2)";

   app.get("/medicaid/breakdown", auth, (req, res) => {
     const dim = DIMS[String(req.query.by)];
     if (!dim) return res.status(400).json({ error: "by must be class, drug or state" });
     guarded(
       req, res, "view_medicaid_breakdown",
       `SELECT ${dim} AS label, SUM(prescriptions)::float8 AS prescriptions, SUM(spend)::float8 AS spend
        FROM serving.medicaid_drug_quarterly ${FILTER}
        GROUP BY 1 ORDER BY spend DESC LIMIT 15`,
       [strOrNull(req.query.class), strOrNull(req.query.drug)]
     );
   });

   app.get("/medicaid/trend", auth, (req, res) =>
     guarded(
       req, res, "view_medicaid_trend",
       `SELECT concat(year, ' Q', quarter) AS period, SUM(prescriptions)::float8 AS prescriptions, SUM(spend)::float8 AS spend
        FROM serving.medicaid_drug_quarterly ${FILTER}
        GROUP BY year, quarter ORDER BY year, quarter`,
       [strOrNull(req.query.class), strOrNull(req.query.drug)]
     )
   );

const GRAINS = new Set(["year", "month", "week", "day"]);
const OPS_DIMS: Record<string, string> = { clinic: "clinic_id::text", department: "department" };
const dateOrNull = (v: unknown) =>
  typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
const OPS_FILTER = `WHERE ($1::int IS NULL OR clinic_id = $1) AND ($2::text IS NULL OR department = $2)
  AND ($3::date IS NULL OR day >= $3) AND ($4::date IS NULL OR day < $4)`;
const opsParams = (q: any) => [
  typeof q.clinic === "string" && /^\d+$/.test(q.clinic) ? Number(q.clinic) : null,
  strOrNull(q.dept),
  dateOrNull(q.from),
  dateOrNull(q.to),
];
const OPS_MEASURES = `SUM(scheduled)::int AS scheduled, SUM(completed)::int AS completed,
  SUM(no_shows)::int AS no_shows,
  ROUND(SUM(no_shows)::numeric / NULLIF(SUM(scheduled), 0), 4)::float8 AS no_show_rate`;

app.get("/ops/trend", auth, (req, res) => {
  const grain = String(req.query.grain ?? "month");
  if (!GRAINS.has(grain)) return res.status(400).json({ error: "grain must be year, month, week or day" });
  guarded(
    req, res, "view_ops_trend",
    `SELECT date_trunc('${grain}', day::timestamp)::date::text AS period, ${OPS_MEASURES}
     FROM serving.clinic_daily ${OPS_FILTER} GROUP BY 1 ORDER BY 1`,
    opsParams(req.query)
  );
});

app.get("/ops/breakdown", auth, (req, res) => {
  const dim = OPS_DIMS[String(req.query.by)];
  if (!dim) return res.status(400).json({ error: "by must be clinic or department" });
  guarded(
    req, res, "view_ops_breakdown",
    `SELECT ${dim} AS label, ${OPS_MEASURES}
     FROM serving.clinic_daily ${OPS_FILTER} GROUP BY 1 ORDER BY 1`,
    opsParams(req.query)
  );
});


   app.get("/catalog", auth, (req, res) =>
     guarded(
       req, res, "view_catalog",
       `SELECT n.nspname AS schema, cl.relname AS "table", a.attname AS "column",
               format_type(a.atttypid, a.atttypmod) AS type,
               obj_description(cl.oid, 'pg_class') AS table_description,
               col_description(cl.oid, a.attnum) AS column_description,
               has_column_privilege(cl.oid, a.attnum, 'SELECT') AS allowed
        FROM pg_attribute a
        JOIN pg_class cl ON cl.oid = a.attrelid AND cl.relkind IN ('r', 'v', 'm')
        JOIN pg_namespace n ON n.oid = cl.relnamespace
        WHERE n.nspname IN ('serving', 'clinical', 'app')
          AND a.attnum > 0 AND NOT a.attisdropped
          AND cl.relname <> 'kpi_demo'
        ORDER BY n.nspname, cl.relname, a.attnum`
     )
   );
   
        registerAssistant(app, { auth, audit });
        app.get("/health", (_req, res) => res.json({ ok: true }));
     app.use(express.static(fileURLToPath(new URL("../../web/dist", import.meta.url))));

   const port = Number(process.env.PORT ?? 4100);
   app.listen(port, () => console.log("API on", port));