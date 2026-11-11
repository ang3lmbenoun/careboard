import "dotenv/config";
import { pool, withRole } from "../src/db.js";
import { plainModel, sendDigest } from "../src/digest.js";

// Usage (from the api folder; add --neon to use Neon):
//   npx tsx scripts/send_digest.ts --add-recipient=you@example.com   add an address to the allow list
//   npx tsx scripts/send_digest.ts --list                            show the allow list and the last sends
//   npx tsx scripts/send_digest.ts --dry-run                         build the digest and write it to api/outbox (sends nothing)
//   npx tsx scripts/send_digest.ts                                   send to every enabled address (needs RESEND_API_KEY)
const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const admin = { role: "admin" as const, clinicId: null };
try {
  const add = arg("add-recipient");
  if (add) {
    await withRole(admin, (c) => c.query("INSERT INTO app.digest_recipients (email) VALUES ($1) ON CONFLICT (email) DO UPDATE SET enabled = true", [add.toLowerCase()]));
    console.log("added to the allow list:", add.toLowerCase());
  } else if (process.argv.includes("--list")) {
    const r = await withRole(admin, async (c) => ({
      recipients: (await c.query("SELECT email, enabled FROM app.digest_recipients ORDER BY email")).rows,
      log: (await c.query("SELECT at, recipient, status, reason, narrative FROM app.digest_log ORDER BY id DESC LIMIT 10")).rows,
    }));
    console.log("allow list:", r.recipients);
    console.table(r.log);
  } else {
    const results = await sendDigest({ dryRun: process.argv.includes("--dry-run"), model: plainModel() });
    console.table(results);
    if (results.some((x) => x.status === "error" || x.status === "blocked")) process.exitCode = 1;
  }
} finally { await pool.end(); }
