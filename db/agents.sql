-- Agent layer (Part 2): run log, step trace, proposed actions, and the kill switch.
-- Safe to run more than once. Run after the base schema and db/risk.sql.
-- Principle: the agent never has access of its own. Every agent query runs as the signed-in user's database role,
-- and these tables are protected by row-level security so a user sees only their own runs.

-- The API sets app.user_id for each request (see withRole in api/src/db.ts).
CREATE OR REPLACE FUNCTION app.current_user_id() RETURNS int
LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('app.user_id', true), '')::int $$;

CREATE TABLE IF NOT EXISTS app.agent_settings (
  key   text PRIMARY KEY,
  value text NOT NULL
);
INSERT INTO app.agent_settings (key, value) VALUES
  ('agents_enabled', 'true'),
  ('max_steps', '6'),
  ('max_tokens_per_run', '8000'),
  ('daily_runs_per_user', '40')
ON CONFLICT (key) DO NOTHING;

CREATE TABLE IF NOT EXISTS app.agent_runs (
  id                bigserial PRIMARY KEY,
  user_id           int  NOT NULL,
  role              text NOT NULL CHECK (role IN ('admin', 'clinician', 'executive')),
  clinic_id         int,
  question          text NOT NULL CHECK (length(question) <= 500),
  status            text NOT NULL DEFAULT 'running'
                    CHECK (status IN ('running', 'finished', 'blocked', 'stopped', 'error')),
  answer            text,
  prompt_tokens     int NOT NULL DEFAULT 0,
  completion_tokens int NOT NULL DEFAULT 0,
  est_cost_usd      numeric(10,5) NOT NULL DEFAULT 0,
  latency_ms        int,
  error             text,
  started_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS agent_runs_user_idx ON app.agent_runs (user_id, started_at DESC);

CREATE TABLE IF NOT EXISTS app.agent_steps (
  id      bigserial PRIMARY KEY,
  run_id  bigint NOT NULL REFERENCES app.agent_runs(id) ON DELETE CASCADE,
  seq     int    NOT NULL,
  kind    text   NOT NULL CHECK (kind IN ('model', 'tool', 'result', 'blocked', 'answer')),
  content jsonb  NOT NULL,
  at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (run_id, seq)
);

CREATE TABLE IF NOT EXISTS app.agent_actions (
  id         bigserial PRIMARY KEY,
  run_id     bigint NOT NULL REFERENCES app.agent_runs(id) ON DELETE CASCADE,
  user_id    int    NOT NULL,
  clinic_id  int,
  tier       int    NOT NULL CHECK (tier IN (1, 2)),
  type       text   NOT NULL CHECK (type IN ('followup_call_list')),
  payload    jsonb  NOT NULL,
  status     text   NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS agent_actions_user_idx ON app.agent_actions (user_id, status);

-- Grants. Nobody can delete or rewrite history: no DELETE anywhere, and only an action's status can change.
REVOKE ALL ON app.agent_settings, app.agent_runs, app.agent_steps, app.agent_actions
  FROM role_admin, role_clinician, role_executive;
GRANT SELECT ON app.agent_settings TO role_admin, role_clinician, role_executive;
GRANT UPDATE (value) ON app.agent_settings TO role_admin;            -- only an admin can flip the kill switch
GRANT SELECT, INSERT ON app.agent_runs, app.agent_steps, app.agent_actions TO role_admin, role_clinician, role_executive;
GRANT UPDATE (status, answer, prompt_tokens, completion_tokens, est_cost_usd, latency_ms, error)
  ON app.agent_runs TO role_admin, role_clinician, role_executive;
GRANT UPDATE (status, decided_at) ON app.agent_actions TO role_admin, role_clinician, role_executive;
GRANT USAGE ON SEQUENCE app.agent_runs_id_seq, app.agent_steps_id_seq, app.agent_actions_id_seq
  TO role_admin, role_clinician, role_executive;

ALTER TABLE app.agent_runs    ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.agent_steps   ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.agent_actions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS runs_own ON app.agent_runs;
CREATE POLICY runs_own ON app.agent_runs FOR ALL TO role_clinician, role_executive, role_admin
  USING (user_id = app.current_user_id())
  WITH CHECK (user_id = app.current_user_id());
DROP POLICY IF EXISTS runs_admin_read ON app.agent_runs;
CREATE POLICY runs_admin_read ON app.agent_runs FOR SELECT TO role_admin USING (true);

-- A step is visible and writable only if its run is (the run's own policy applies inside the subquery).
DROP POLICY IF EXISTS steps_via_run ON app.agent_steps;
CREATE POLICY steps_via_run ON app.agent_steps FOR ALL TO role_clinician, role_executive, role_admin
  USING (EXISTS (SELECT 1 FROM app.agent_runs r WHERE r.id = run_id))
  WITH CHECK (EXISTS (SELECT 1 FROM app.agent_runs r WHERE r.id = run_id AND r.user_id = app.current_user_id()));

DROP POLICY IF EXISTS actions_own ON app.agent_actions;
CREATE POLICY actions_own ON app.agent_actions FOR ALL TO role_clinician, role_executive, role_admin
  USING (user_id = app.current_user_id())
  WITH CHECK (user_id = app.current_user_id());
DROP POLICY IF EXISTS actions_admin_read ON app.agent_actions;
CREATE POLICY actions_admin_read ON app.agent_actions FOR SELECT TO role_admin USING (true);

COMMENT ON TABLE app.agent_runs    IS 'One row per agent run: who asked, status, tokens, estimated cost, latency.';
COMMENT ON TABLE app.agent_steps   IS 'Every model step, tool call, tool result and block in a run, in order.';
COMMENT ON TABLE app.agent_actions IS 'Actions an agent proposed. Tier 2 waits here until the user approves or rejects.';
COMMENT ON TABLE app.agent_settings IS 'Kill switch (agents_enabled) and per run limits. Only admin can change values.';
