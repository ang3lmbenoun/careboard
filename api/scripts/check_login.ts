import pg from "pg";
import bcrypt from "bcryptjs";

const pw = process.env.DEMO_PASSWORD ?? "";
console.log("DEMO_PASSWORD length:", pw.length, "| has leading/trailing space:", pw !== pw.trim());
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const { rows } = await pool.query("SELECT email, role, password_hash FROM app.users ORDER BY id");
for (const r of rows) {
  console.log(r.email, r.role, "match:", await bcrypt.compare(pw, r.password_hash));
}
await pool.end();