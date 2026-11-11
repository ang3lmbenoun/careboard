-- Follow-up emails sent by the agent after a person approves. Safe to run more than once.
-- Run after db/agents.sql and db/digest.sql.
-- 1) A new action type: an emailed follow-up list. 2) The action records what happened to it (outcome).
-- 3) The send log can hold follow-up emails; the one-send-per-day rule stays for the executive digest only.

ALTER TABLE app.agent_actions DROP CONSTRAINT IF EXISTS agent_actions_type_check;
ALTER TABLE app.agent_actions ADD CONSTRAINT agent_actions_type_check CHECK (type IN ('followup_call_list', 'email_followup_list'));
ALTER TABLE app.agent_actions ADD COLUMN IF NOT EXISTS outcome text;
GRANT UPDATE (status, decided_at, outcome) ON app.agent_actions TO role_admin, role_clinician, role_executive;

ALTER TABLE app.digest_log DROP CONSTRAINT IF EXISTS digest_log_kind_check;
ALTER TABLE app.digest_log ADD CONSTRAINT digest_log_kind_check CHECK (kind IN ('executive', 'followup'));
DROP INDEX IF EXISTS app.digest_one_send_per_day;
CREATE UNIQUE INDEX digest_one_send_per_day ON app.digest_log (recipient, kind, digest_date) WHERE status = 'sent' AND kind = 'executive';
