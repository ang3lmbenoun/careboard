   import "dotenv/config";
   import express from "express";
   import bcrypt from "bcryptjs";
   import jwt from "jsonwebtoken";
   import { pool, withRole, type Role } from "./db.js";

   const SECRET = process.env.JWT_SECRET;
   if (!SECRET) throw new Error("JWT_SECRET missing in api/.env");

   type Claims = { sub: number; role: Role; clinicId: number | null };

   const app = express();
   app.use(express.json());

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

   app.post("/auth/login", async (req, res) => {
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

   const port = Number(process.env.PORT ?? 4100);
   app.listen(port, () => console.log("API on", port));