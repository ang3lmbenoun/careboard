# Proactive Tiffany (step F): what it does and what it does not

Status: built 2026-11-26; local tests pending; not applied to Neon.

## What it does
1. **Weekly review (rule, no model).** For each clinician, the review reads `clinical.care_risk` as that clinician (`withRole`, so row-level security limits it to their clinic) and picks up to 5 **High** tier patients. It skips any patient already on a pending list, or on a list approved or rejected in the last 14 days.
2. **Draft only.** It writes one tier 2 action, type `followup_call_list`, status `pending`, `origin = 'scheduled'`. Nothing is sent or decided. The clinician sees it under "Waiting for you" on the Tiffany page, marked as drafted by the weekly review.
3. **Same trace as a chat run.** One `app.agent_runs` row and three steps (tool, result, answer). The kill switch (`agents_enabled`) stops it.
4. **Outcome check.** Seven days or more after an approval, the system counts which listed patients have a reading (A1C or weight) dated on or after the approval day. It stores counts only in `outcome_detail` and shows "X of Y patients have a new reading since you approved" under Follow-ups. It checks each approval once.

## What it does not do
- It does not call a language model, so it can not hallucinate a patient. The model is not involved in who is chosen.
- It does not approve, email or message anyone.
- A new reading means someone recorded a measurement. It is a sign of follow-up, not proof that a call happened or that the patient's health changed.
- Two clinicians in the same clinic each get their own draft; each sees only their own actions.
- `origin` is a label set by the server code. It is not a security control.

## Files
`db/proactive.sql` (3 columns, 1 grant) · `api/scripts/apply_proactive.ts` · `api/src/proactive.ts` · `api/scripts/proactive_review.ts` (`--dry-run`, `--user=`, `--neon`) · `api/scripts/test_proactive.ts` · `.github/workflows/proactive-review.yml` (off until the variable `PROACTIVE_NEON` is `true`) · small changes in `api/src/agent.ts` (list endpoint returns two more fields) and `web/src/Agent.tsx`.

## Neon order
`apply_proactive.ts --neon` first, then push code (Render redeploys on push), then optionally set `PROACTIVE_NEON=true`.
