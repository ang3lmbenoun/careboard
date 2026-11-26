import "dotenv/config";
import { pool } from "../src/db.js";
import { checkOutcomes, scanForClinician } from "../src/proactive.js";

// Usage (from the api folder; add --neon to use Neon):
//   npx tsx scripts/proactive_review.ts --dry-run       show what each clinician would be offered; writes nothing
//   npx tsx scripts/proactive_review.ts                 draft one call list per clinician (waits for approval) and check old approvals
//   options: --user=<email> limits it to one clinician
// It runs as each clinician (their role, their clinic), so row-level security applies. It never approves anything and calls no model.
const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const dry = process.argv.includes("--dry-run");
const only = arg("user")?.toLowerCase();
let code = 0;
try {
  const users = (await pool.query("SELECT id, email, clinic_id FROM app.users WHERE role = 'clinician' ORDER BY id")).rows
    .filter((u) => !only || u.email.toLowerCase() === only);
  if (!users.length) console.log("no clinician accounts found");
  for (const u of users) {
    const user = { sub: u.id as number, role: "clinician" as const, clinicId: u.clinic_id as number | null };
    try {
      const s = await scanForClinician(user, { dryRun: dry });
      const text = s.status === "proposed" ? `drafted action ${s.action_id} for patients ${s.patient_ids.join(", ")}`
        : s.status === "dry_run" ? `would draft a list for patients ${s.patient_ids.join(", ")}`
        : s.status === "skipped" ? `skipped: ${s.reason}` : "nothing to propose";
      console.log(`${u.email} (clinic ${u.clinic_id}): ${text}`);
      if (!dry) for (const o of await checkOutcomes(user)) console.log(`  outcome for action ${o.action_id}: ${o.with_new_reading} of ${o.total} patients have a new reading`);
    } catch (e: any) { console.error(`${u.email}: ERROR ${e.message}`); code = 1; }
  }
} finally { await pool.end(); }
process.exit(code);
