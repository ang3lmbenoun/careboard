   import pg from "pg";

      // Scripts can target Neon with --neon (direct host, API login). The server uses DATABASE_URL.
   function connectionString() {
     if (!process.argv.includes("--neon")) return process.env.DATABASE_URL;
     const u = new URL(process.env.NEON_ADMIN_URL!);
     u.username = "careboard_api";
     u.password = process.env.NEON_API_PASSWORD!;
     u.hostname = u.hostname.replace("-pooler", "");
     u.searchParams.delete("channel_binding");
     return u.toString();
   }
   export const pool = new pg.Pool({ connectionString: connectionString() });

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

// The assistant role can only SELECT from two summary tables. READ ONLY and the timeout are extra layers.
export async function withAssistant<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query("BEGIN READ ONLY");
    await c.query("SET LOCAL ROLE role_assistant");
    await c.query("SET LOCAL statement_timeout = 5000");
    await c.query("SET LOCAL search_path = serving");
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
