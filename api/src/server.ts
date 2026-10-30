   import { fileURLToPath } from "node:url";
   import "dotenv/config";
   import express from "express";
   import bcrypt from "bcryptjs";
   import jwt from "jsonwebtoken";
   import { pool, withRole, type Role } from "./db.js";
   import helmet from "helmet";
   import rateLimit from "express-rate-limit";
import { registerAssistant } from "./assistant.js";

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
   app.get("/patients", auth, (req, res) =>
     guarded(req, res, "view_patients", "SELECT patient_id, clinic_id, birth_year, city, primary_condition FROM clinical.patients ORDER BY patient_id"));
   app.get("/audit", auth, (req, res) =>
     guarded(req, res, "view_audit", "SELECT id, at, user_id, role, action FROM app.audit_log ORDER BY id DESC LIMIT 50"));

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