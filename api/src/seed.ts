   import "dotenv/config";
   import bcrypt from "bcryptjs";
   import { pool, withRole } from "./db.js";

   const demo = [
     { email: "admin@careboard.dev", name: "Demo Admin", role: "admin", clinic: null },
     { email: "clinician@careboard.dev", name: "Demo Clinician", role: "clinician", clinic: 1 },
     { email: "executive@careboard.dev", name: "Demo Executive", role: "executive", clinic: null },
   ];

   const pw = process.env.DEMO_PASSWORD;
   if (!pw) throw new Error("DEMO_PASSWORD missing in api/.env");
   const hash = await bcrypt.hash(pw, 10);

   await withRole({ role: "admin", clinicId: null }, async (c) => {
     for (const u of demo) {
       await c.query(
         `INSERT INTO app.users (email, display_name, password_hash, role, clinic_id)
          VALUES ($1, $2, $3, $4, $5)
          ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash`,
         [u.email, u.name, hash, u.role, u.clinic]
       );
     }
   });
   console.log("seeded", demo.length, "users");
   await pool.end();