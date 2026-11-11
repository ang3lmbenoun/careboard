import "dotenv/config";
import bcrypt from "bcryptjs";
import pg from "pg";

// Usage (from the api folder):  npx tsx src/seed.ts                                  -> all demo accounts, local database
//                               npx tsx src/seed.ts --neon                           -> all demo accounts, Neon
//                               npx tsx src/seed.ts --neon --only=nurse@careboard.dev -> one account, others untouched
// Runs with the admin login: since risk.sql the admin ROLE can no longer read password hashes, so it cannot upsert them.
const demo = [
  { email: "admin@careboard.dev", name: "Demo Admin", role: "admin", clinic: null },
  { email: "clinician@careboard.dev", name: "Demo Clinician", role: "clinician", clinic: 1 },
  { email: "executive@careboard.dev", name: "Demo Executive", role: "executive", clinic: null },
  { email: "nurse@careboard.dev", name: "Demo Nurse", role: "nurse", clinic: 1 },
];

const neon = process.argv.includes("--neon");
const adminUrl = neon ? process.env.NEON_ADMIN_URL : process.env.ADMIN_DATABASE_URL;
if (!adminUrl) throw new Error(neon ? "NEON_ADMIN_URL missing in api/.env" : "ADMIN_DATABASE_URL missing in api/.env");
const only = process.argv.find((a) => a.startsWith("--only="))?.slice(7).toLowerCase();
const users = only ? demo.filter((u) => u.email === only) : demo;
if (only && users.length === 0) throw new Error("no demo account with that email");

const pw = process.env.DEMO_PASSWORD;
if (!pw) throw new Error("DEMO_PASSWORD missing in api/.env");
const hash = await bcrypt.hash(pw, 10);

const db = new pg.Pool({ connectionString: adminUrl });
for (const u of users) {
  await db.query(
    `INSERT INTO app.users (email, display_name, password_hash, role, clinic_id)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash`,
    [u.email, u.name, hash, u.role, u.clinic]
  );
}
console.log("seeded", users.length, "users on", neon ? "Neon" : "local database");
await db.end();
