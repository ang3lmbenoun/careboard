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
   async function guarded(req: any, res: any, action: string, sql: string) {
     try {
       const rows = await withRole(req.user, async (c) => (await c.query(sql)).rows);
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
     guarded(req, res, "view_kpis", "SELECT metric, period, value FROM serving.kpi_demo ORDER BY metric, period"));
   app.get("/patients", auth, (req, res) =>
     guarded(req, res, "view_patients", "SELECT patient_id, clinic_id, birth_year, city, primary_condition FROM clinical.patients ORDER BY patient_id"));
   app.get("/audit", auth, (req, res) =>
     guarded(req, res, "view_audit", "SELECT id, at, user_id, role, action FROM app.audit_log ORDER BY id DESC LIMIT 50"));

   const port = Number(process.env.PORT ?? 4100);
   app.listen(port, () => console.log("API on", port));