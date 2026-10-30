   import "dotenv/config";
   import fs from "node:fs";
   import { fileURLToPath } from "node:url";
   import pg from "pg";

   const url = process.env.NEON_ADMIN_URL;
   const apiPw = process.env.NEON_API_PASSWORD;
   if (!url || !apiPw) throw new Error("NEON_ADMIN_URL and NEON_API_PASSWORD are required in api/.env");

   const dir = fileURLToPath(new URL("../../db/init/", import.meta.url));
   const files = fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();

   const c = new pg.Client({ connectionString: url });
   await c.connect();
   try {
     const { rows } = await c.query("SELECT to_regnamespace('serving') AS s");
     if (rows[0].s) throw new Error("serving schema already exists; refusing to run bootstrap twice");
     await c.query("BEGIN");
     for (const f of files) {
       await c.query(fs.readFileSync(dir + f, "utf8"));
       console.log("ran", f);
     }
     await c.query(`ALTER ROLE careboard_api PASSWORD '${apiPw.replace(/'/g, "''")}'`);
     console.log("set careboard_api password");
     await c.query("COMMIT");
   } catch (e) {
     await c.query("ROLLBACK");
     throw e;
   } finally {
     await c.end();
   }