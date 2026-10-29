   import pg from "pg";

   export const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

   const ROLE = {
     admin: "role_admin",
     clinician: "role_clinician",
     executive: "role_executive",
   } as const;
   export type Role = keyof typeof ROLE;

   export async function withRole<T>(
     user: { role: Role; clinicId: number | null },
     fn: (c: pg.PoolClient) => Promise<T>
   ): Promise<T> {
     const c = await pool.connect();
     try {
       await c.query("BEGIN");
       await c.query(`SET LOCAL ROLE ${ROLE[user.role]}`);
       await c.query("SELECT set_config('app.clinic_id', $1, true)", [
         user.clinicId == null ? "" : String(user.clinicId),
       ]);
       const out = await fn(c);
       await c.query("COMMIT");
       return out;
     } catch (e) {
       await c.query("ROLLBACK");
       throw e;
     } finally {
       c.release();
     }
   }