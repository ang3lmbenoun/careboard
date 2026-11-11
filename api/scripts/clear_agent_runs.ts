import "dotenv/config";
import pg from "pg";

// Deletes every agent run (and its steps and proposals) from the LOCAL database. Use once after the earlier evaluation
// runs, which counted against the demo users' daily run allowance. Refuses to touch Neon.
// Usage (from the api folder):  npx tsx scripts/clear_agent_runs.ts
if (process.argv.includes("--neon") || /neon\.tech/.test(process.env.ADMIN_DATABASE_URL ?? "")) {
  console.error("Refusing: local database only.");
  process.exit(1);
}
const db = new pg.Pool({ connectionString: process.env.ADMIN_DATABASE_URL });
const r = await db.query("DELETE FROM app.agent_runs");
console.log(`Deleted ${r.rowCount} local agent runs.`);
await db.end();
