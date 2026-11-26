import { withRole, type Role } from "./db.js";

/*
  Proactive review (step F). Rules, in the order they matter:
    - The patients are chosen by a database rule (High tier on the care-risk view), not by a model. No model is called here.
    - It runs as the clinician, through withRole, so row-level security limits it to that clinician's clinic and own actions.
    - It only drafts. The draft is a normal tier 2 action, "pending", and nothing happens until the clinician approves it.
    - It respects the kill switch (app.agent_settings.agents_enabled) and leaves the same run and step trace as a chat run.
    - A patient already on a pending, recently approved or recently rejected list is not proposed again for COOLDOWN_DAYS.
    - Seven days after an approval it counts which listed patients have a reading dated on or after the approval day.
      A reading is a sign that someone followed up, not proof that the call happened.
*/
export type User = { sub: number; role: Role; clinicId: number | null };
export const COOLDOWN_DAYS = 14;
export const OUTCOME_AFTER_DAYS = 7;
export const MAX_PATIENTS = 5;
const LIST_TYPES = ["followup_call_list", "email_followup_list"];

export type Candidate = { patient_id: number; tier: string; points: number; latest_a1c: number | null; days_since_a1c: number | null; reasons: string[] };
export type ScanResult =
  | { status: "skipped"; reason: string }
  | { status: "nothing"; run_id?: number }
  | { status: "dry_run"; patient_ids: number[]; reason: string }
  | { status: "proposed"; patient_ids: number[]; reason: string; action_id: number; run_id: number };

/** The sentence stored with the draft. Built from numbers in the database, not written by a model. */
export function buildReason(rows: Pick<Candidate, "points">[], cooldownDays = COOLDOWN_DAYS): string {
  const n = rows.length;
  const top = Math.max(...rows.map((r) => r.points));
  return `Weekly review: ${n} High-risk patient${n === 1 ? "" : "s"} with no follow-up proposed or decided in the last ${cooldownDays} days. Highest score: ${top} points.`;
}

export async function scanForClinician(user: User, opts: { dryRun?: boolean } = {}): Promise<ScanResult> {
  if (user.role !== "clinician") throw new Error("the scheduled review is for clinicians only");
  return withRole(user, async (c) => {
    const on = (await c.query("SELECT value FROM app.agent_settings WHERE key = 'agents_enabled'")).rows[0]?.value === "true";
    if (!on) return { status: "skipped", reason: "agents are switched off" } as ScanResult;
    const open = await c.query("SELECT 1 FROM app.agent_actions WHERE origin = 'scheduled' AND status = 'pending' LIMIT 1");
    if (open.rowCount) return { status: "skipped", reason: "a scheduled draft is still waiting for approval" } as ScanResult;

    const cand = (await c.query(
      `SELECT r.patient_id, r.tier, r.points, r.latest_a1c::float8 AS latest_a1c, r.days_since_a1c, r.reasons
         FROM clinical.care_risk r
        WHERE r.tier = 'High'
          AND NOT EXISTS (
            SELECT 1 FROM app.agent_actions a
             WHERE a.type = ANY($3::text[])
               AND a.payload->'patient_ids' @> to_jsonb(r.patient_id)
               AND (a.status = 'pending' OR (a.status IN ('approved', 'rejected') AND a.decided_at > now() - make_interval(days => $1))))
        ORDER BY r.points DESC, r.patient_id
        LIMIT $2`, [COOLDOWN_DAYS, MAX_PATIENTS, LIST_TYPES])).rows as Candidate[];

    const ids = cand.map((r) => r.patient_id);
    if (opts.dryRun) return cand.length ? ({ status: "dry_run", patient_ids: ids, reason: buildReason(cand) } as ScanResult) : ({ status: "nothing" } as ScanResult);

    const question = "Scheduled review of the risk worklist";
    const reason = cand.length ? buildReason(cand) : "";
    const answer = cand.length
      ? `Drafted a call list of ${ids.length} patient${ids.length === 1 ? "" : "s"}. It is waiting for your approval.`
      : "No High-risk patient needs a new follow-up right now.";
    const run = (await c.query(
      `INSERT INTO app.agent_runs (user_id, role, clinic_id, question, status, answer, latency_ms) VALUES ($1, $2, $3, $4, 'finished', $5, 0) RETURNING id`,
      [user.sub, user.role, user.clinicId, question, answer])).rows[0].id as number;
    const step = (seq: number, kind: string, content: object) =>
      c.query("INSERT INTO app.agent_steps (run_id, seq, kind, content) VALUES ($1, $2, $3, $4)", [run, seq, kind, JSON.stringify(content)]);
    await step(1, "tool", { name: "scheduled_review", args: { tier: "High", cooldown_days: COOLDOWN_DAYS, max_patients: MAX_PATIENTS }, note: "Chosen by a database rule. No model was called." });
    await step(2, "result", { patient_ids: ids, count: ids.length });
    await step(3, "answer", { text: answer });
    if (!cand.length) return { status: "nothing", run_id: run } as ScanResult;
    const action = (await c.query(
      `INSERT INTO app.agent_actions (run_id, user_id, clinic_id, tier, type, payload, origin) VALUES ($1, $2, $3, 2, 'followup_call_list', $4, 'scheduled') RETURNING id`,
      [run, user.sub, user.clinicId, JSON.stringify({ patient_ids: ids, reason })])).rows[0].id as number;
    return { status: "proposed", patient_ids: ids, reason, action_id: action, run_id: run } as ScanResult;
  });
}

export type OutcomeDetail = {
  checked_after_days: number;
  since: string;
  total: number;
  with_new_reading: number;
  with_new_a1c: number;
  patients: { patient_id: number; new_readings: number; new_a1c: number }[];
};

/** Looks once at each approved list that is at least afterDays old and has not been checked. Counts only, no values. */
export async function checkOutcomes(user: User, opts: { afterDays?: number } = {}): Promise<{ action_id: number; with_new_reading: number; total: number }[]> {
  const afterDays = opts.afterDays ?? OUTCOME_AFTER_DAYS;
  return withRole(user, async (c) => {
    const acts = (await c.query(
      `SELECT id, payload, (decided_at AT TIME ZONE 'UTC')::date::text AS since
         FROM app.agent_actions
        WHERE status = 'approved' AND type = ANY($2::text[]) AND outcome_checked_at IS NULL
          AND decided_at <= now() - make_interval(days => $1)
        ORDER BY id`, [afterDays, LIST_TYPES])).rows;
    const out: { action_id: number; with_new_reading: number; total: number }[] = [];
    for (const a of acts) {
      const ids: number[] = a.payload?.patient_ids ?? [];
      const rows = (await c.query(
        `SELECT p.patient_id, count(r.reading_id)::int AS n, (count(r.reading_id) FILTER (WHERE r.a1c IS NOT NULL))::int AS a1c
           FROM clinical.patients p
           LEFT JOIN clinical.patient_readings r ON r.patient_id = p.patient_id AND r.taken_on >= $2::date
          WHERE p.patient_id = ANY($1::int[]) GROUP BY p.patient_id`, [ids, a.since])).rows;
      const by = new Map(rows.map((r) => [r.patient_id as number, r]));
      const patients = ids.map((id) => ({ patient_id: id, new_readings: by.get(id)?.n ?? 0, new_a1c: by.get(id)?.a1c ?? 0 }));
      const detail: OutcomeDetail = {
        checked_after_days: afterDays, since: a.since, total: ids.length,
        with_new_reading: patients.filter((p) => p.new_readings > 0).length,
        with_new_a1c: patients.filter((p) => p.new_a1c > 0).length, patients,
      };
      await c.query("UPDATE app.agent_actions SET outcome_checked_at = now(), outcome_detail = $2 WHERE id = $1", [a.id, JSON.stringify(detail)]);
      out.push({ action_id: a.id, with_new_reading: detail.with_new_reading, total: detail.total });
    }
    return out;
  });
}
