   import "dotenv/config";
   import pg from "pg";

   const pw = process.env.NEW_NEON_API_PASSWORD;
   if (!pw || !/^[A-Za-z0-9]{24,}$/.test(pw)) throw new Error("NEW_NEON_API_PASSWORD must be 24+ letters and digits");

   const c = new pg.Client({ connectionString: process.env.NEON_ADMIN_URL });
   await c.connect();
   await c.query(`ALTER ROLE careboard_api PASSWORD '${pw}'`);
   await c.end();
   console.log("rotated");