   import "dotenv/config";
   import pg from "pg";

   const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

   async function countAs(role: string, clinic: string | null) {
     const c = await pool.connect();
     try {
       await c.query("BEGIN");
       await c.query(`SET LOCAL ROLE ${role}`); // fixed list only, never user input
       if (clinic) await c.query("SELECT set_config('app.clinic_id', $1, true)", [clinic]);
       const r = await c.query("SELECT count(*)::int AS n FROM clinical.patients");
       console.log(role, "clinic", clinic ?? "none", "-> rows:", r.rows[0].n);
     } catch (e: any) {
       console.log(role, "clinic", clinic ?? "none", "-> DENIED:", e.message);
     } finally {
       await c.query("ROLLBACK");
       c.release();
     }
   }

   await countAs("role_clinician", "1");
   await countAs("role_clinician", "2");
   await countAs("role_clinician", null);
   await countAs("role_executive", null);
   await countAs("role_admin", null);
   await pool.end();