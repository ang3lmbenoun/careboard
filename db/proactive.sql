-- Proactive Tiffany (step F): a scheduled review drafts a follow-up call list for the clinician to approve, and
-- seven days after an approval the system checks whether those patients got a new reading.
-- Safe to run more than once. Run after db/agents.sql and db/mail.sql. Applied by api/scripts/apply_proactive.ts.
ALTER TABLE app.agent_actions
  ADD COLUMN IF NOT EXISTS origin             text NOT NULL DEFAULT 'user' CHECK (origin IN ('user', 'scheduled')),
  ADD COLUMN IF NOT EXISTS outcome_checked_at timestamptz,
  ADD COLUMN IF NOT EXISTS outcome_detail     jsonb;

COMMENT ON COLUMN app.agent_actions.origin IS 'user: proposed during a chat the user started. scheduled: drafted by the scheduled review. Informational; approval is required either way.';
COMMENT ON COLUMN app.agent_actions.outcome_checked_at IS 'When the system looked for new readings after the approval. Empty until the check has run once.';
COMMENT ON COLUMN app.agent_actions.outcome_detail IS 'Result of that check: how many of the listed patients have a reading dated on or after the approval day. Counts only, no values.';

-- Clinicians (whose lists these are) may record the outcome check on their own actions; row-level security still limits them to their own rows.
GRANT UPDATE (outcome_checked_at, outcome_detail) ON app.agent_actions TO role_clinician;
