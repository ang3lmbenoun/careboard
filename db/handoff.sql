-- Nurse and clinician hand-off (Stage 3.6). Safe to run more than once. Run after db/nurse.sql, db/agents.sql and db/mail.sql.
-- Part 1: who entered a record. current_user is the database role of the session (role_nurse, role_clinician), so
-- the label cannot be typed or faked. Rows from before this change keep an empty label.

ALTER TABLE clinical.patients            ADD COLUMN IF NOT EXISTS entered_via text;
ALTER TABLE clinical.patient_medications ADD COLUMN IF NOT EXISTS entered_via text;
ALTER TABLE clinical.patient_readings    ADD COLUMN IF NOT EXISTS entered_via text;
ALTER TABLE clinical.patients            ALTER COLUMN entered_via SET DEFAULT current_user;
ALTER TABLE clinical.patient_medications ALTER COLUMN entered_via SET DEFAULT current_user;
ALTER TABLE clinical.patient_readings    ALTER COLUMN entered_via SET DEFAULT current_user;
GRANT SELECT (entered_via) ON clinical.patients, clinical.patient_medications, clinical.patient_readings TO role_clinician;

-- Part 2: messages between a nurse and the clinicians of the same clinic.
-- Free text is data, never instructions: no agent reads a message back. Messages cannot be edited or deleted; the
-- only change allowed is the recipient marking one as read. The sender and clinic come from the session, not the request.
GRANT SELECT (entered_via) ON clinical.patients, clinical.patient_medications, clinical.patient_readings TO role_nurse;

CREATE OR REPLACE FUNCTION app.current_clinic() RETURNS int
LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('app.clinic_id', true), '')::int $$;

-- The people this user may message: the other role in the same clinic. Runs with owner rights so a nurse can see
-- names without being able to read the users table.
CREATE OR REPLACE FUNCTION app.clinic_contacts() RETURNS TABLE (id int, display_name text, role text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
  SELECT u.id, u.display_name, u.role
    FROM app.users u JOIN app.users me ON me.id = app.current_user_id()
   WHERE u.clinic_id = me.clinic_id AND u.id <> me.id
     AND ((me.role = 'nurse' AND u.role = 'clinician') OR (me.role = 'clinician' AND u.role = 'nurse'))
$$;
CREATE OR REPLACE FUNCTION app.can_message(to_id int, my_role text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM app.users u WHERE u.id = to_id AND u.clinic_id = app.current_clinic()
                  AND ((my_role = 'role_nurse' AND u.role = 'clinician') OR (my_role = 'role_clinician' AND u.role = 'nurse')))
$$;
REVOKE ALL ON FUNCTION app.clinic_contacts(), app.can_message(int, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.clinic_contacts(), app.can_message(int, text) TO role_nurse, role_clinician;
GRANT EXECUTE ON FUNCTION app.current_clinic() TO role_nurse, role_clinician;

CREATE TABLE IF NOT EXISTS app.messages (
  id               bigserial PRIMARY KEY,
  clinic_id        int NOT NULL DEFAULT app.current_clinic(),
  from_user        int NOT NULL DEFAULT app.current_user_id(),
  to_user          int NOT NULL,
  patient_id       int REFERENCES clinical.patients(patient_id) ON DELETE SET NULL,
  parent_id        bigint REFERENCES app.messages(id),
  subject          text NOT NULL CHECK (length(subject) BETWEEN 1 AND 120),
  body             text NOT NULL CHECK (length(body) BETWEEN 1 AND 1500),
  drafted_by_agent boolean NOT NULL DEFAULT false,
  created_at       timestamptz NOT NULL DEFAULT now(),
  read_at          timestamptz
);
CREATE INDEX IF NOT EXISTS messages_to_idx   ON app.messages (to_user, created_at DESC);
CREATE INDEX IF NOT EXISTS messages_from_idx ON app.messages (from_user, created_at DESC);

REVOKE ALL ON app.messages FROM role_admin, role_executive, role_clinician, role_nurse;
GRANT SELECT ON app.messages TO role_clinician, role_nurse;
GRANT INSERT (to_user, patient_id, parent_id, subject, body, drafted_by_agent) ON app.messages TO role_clinician, role_nurse;
GRANT UPDATE (read_at) ON app.messages TO role_clinician, role_nurse;
GRANT USAGE ON SEQUENCE app.messages_id_seq TO role_clinician, role_nurse;
ALTER TABLE app.messages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS msg_read ON app.messages;
CREATE POLICY msg_read ON app.messages FOR SELECT TO role_clinician, role_nurse
  USING (from_user = app.current_user_id() OR to_user = app.current_user_id());
DROP POLICY IF EXISTS msg_send ON app.messages;
CREATE POLICY msg_send ON app.messages FOR INSERT TO role_clinician, role_nurse
  WITH CHECK (from_user = app.current_user_id() AND clinic_id = app.current_clinic()
              AND app.can_message(to_user, current_user::text)
              AND (patient_id IS NULL OR EXISTS (SELECT 1 FROM clinical.patients p WHERE p.patient_id = messages.patient_id)));
DROP POLICY IF EXISTS msg_mark_read ON app.messages;
CREATE POLICY msg_mark_read ON app.messages FOR UPDATE TO role_clinician, role_nurse
  USING (to_user = app.current_user_id()) WITH CHECK (to_user = app.current_user_id());

-- Part 3: checks on entered records. A nurse (or clinician) marks a record verified or needing correction.
-- Insert only: a later check replaces an earlier one in the view, and history is kept.
CREATE TABLE IF NOT EXISTS app.record_checks (
  id          bigserial PRIMARY KEY,
  clinic_id   int NOT NULL DEFAULT app.current_clinic(),
  patient_id  int NOT NULL REFERENCES clinical.patients(patient_id) ON DELETE CASCADE,
  record_type text NOT NULL CHECK (record_type IN ('patient', 'medication', 'reading')),
  record_id   int  NOT NULL,
  status      text NOT NULL CHECK (status IN ('verified', 'needs_correction')),
  note        text CHECK (note IS NULL OR length(note) <= 200),
  checked_by  int  DEFAULT app.current_user_id(),
  checked_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS record_checks_rec_idx ON app.record_checks (record_type, record_id, id DESC);
REVOKE ALL ON app.record_checks FROM role_admin, role_executive, role_clinician, role_nurse;
GRANT SELECT ON app.record_checks TO role_clinician, role_nurse;
GRANT INSERT (patient_id, record_type, record_id, status, note) ON app.record_checks TO role_clinician, role_nurse;
GRANT USAGE ON SEQUENCE app.record_checks_id_seq TO role_clinician, role_nurse;
ALTER TABLE app.record_checks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS chk_read ON app.record_checks;
CREATE POLICY chk_read ON app.record_checks FOR SELECT TO role_clinician, role_nurse
  USING (EXISTS (SELECT 1 FROM clinical.patients p WHERE p.patient_id = record_checks.patient_id));
DROP POLICY IF EXISTS chk_add ON app.record_checks;
CREATE POLICY chk_add ON app.record_checks FOR INSERT TO role_clinician, role_nurse
  WITH CHECK (clinic_id = app.current_clinic() AND EXISTS (SELECT 1 FROM clinical.patients p WHERE p.patient_id = record_checks.patient_id));

-- Part 4: medicine stock. Items are shared; counts belong to a clinic and are added, never edited.
CREATE TABLE IF NOT EXISTS clinical.stock_items (
  item_id       serial PRIMARY KEY,
  drug          text UNIQUE NOT NULL,
  drug_class    text NOT NULL CHECK (drug_class IN ('GLP-1', 'Insulin', 'DPP-4', 'Metformin')),
  unit          text NOT NULL,
  reorder_level int  NOT NULL CHECK (reorder_level >= 0)
);
CREATE TABLE IF NOT EXISTS clinical.stock_counts (
  id          bigserial PRIMARY KEY,
  clinic_id   int NOT NULL DEFAULT app.current_clinic(),
  item_id     int NOT NULL REFERENCES clinical.stock_items(item_id),
  quantity    int NOT NULL CHECK (quantity BETWEEN 0 AND 100000),
  note        text CHECK (note IS NULL OR length(note) <= 120),
  counted_by  int DEFAULT app.current_user_id(),
  counted_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS stock_counts_idx ON clinical.stock_counts (clinic_id, item_id, id DESC);
INSERT INTO clinical.stock_items (drug, drug_class, unit, reorder_level) VALUES
  ('Metformin 500 mg', 'Metformin', 'tablets', 200),
  ('Semaglutide pen', 'GLP-1', 'pens', 12),
  ('Dulaglutide pen', 'GLP-1', 'pens', 12),
  ('Insulin glargine pen', 'Insulin', 'pens', 15),
  ('Insulin lispro pen', 'Insulin', 'pens', 15),
  ('Sitagliptin 100 mg', 'DPP-4', 'tablets', 100)
ON CONFLICT (drug) DO NOTHING;
-- Starting counts for each clinic (some below the reorder level, so the demo has something to show).
INSERT INTO clinical.stock_counts (clinic_id, item_id, quantity, note)
SELECT c.clinic_id, i.item_id,
       CASE WHEN (i.item_id + c.clinic_id) % 3 = 0 THEN i.reorder_level / 2 ELSE i.reorder_level * 2 END, 'Starting count'
  FROM (SELECT DISTINCT clinic_id FROM app.users WHERE clinic_id IS NOT NULL) c CROSS JOIN clinical.stock_items i
 WHERE NOT EXISTS (SELECT 1 FROM clinical.stock_counts s WHERE s.clinic_id = c.clinic_id AND s.item_id = i.item_id);
REVOKE ALL ON clinical.stock_items, clinical.stock_counts FROM role_admin, role_executive, role_clinician, role_nurse;
GRANT SELECT ON clinical.stock_items, clinical.stock_counts TO role_clinician, role_nurse;
GRANT INSERT (item_id, quantity, note) ON clinical.stock_counts TO role_nurse;
GRANT USAGE ON SEQUENCE clinical.stock_counts_id_seq TO role_nurse;
ALTER TABLE clinical.stock_counts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS stock_read ON clinical.stock_counts;
CREATE POLICY stock_read ON clinical.stock_counts FOR SELECT TO role_clinician, role_nurse USING (clinic_id = app.current_clinic());
DROP POLICY IF EXISTS stock_add ON clinical.stock_counts;
CREATE POLICY stock_add ON clinical.stock_counts FOR INSERT TO role_nurse WITH CHECK (clinic_id = app.current_clinic());

-- Part 5: the nurse agent (Tiffany drafts a hand-off message; the nurse approves before it is sent).
ALTER TABLE app.agent_runs DROP CONSTRAINT IF EXISTS agent_runs_role_check;
ALTER TABLE app.agent_runs ADD CONSTRAINT agent_runs_role_check CHECK (role IN ('admin', 'clinician', 'executive', 'nurse'));
ALTER TABLE app.agent_actions DROP CONSTRAINT IF EXISTS agent_actions_type_check;
ALTER TABLE app.agent_actions ADD CONSTRAINT agent_actions_type_check CHECK (type IN ('followup_call_list', 'email_followup_list', 'handoff_message'));
GRANT SELECT ON app.agent_settings TO role_nurse;
GRANT SELECT, INSERT ON app.agent_runs, app.agent_steps, app.agent_actions TO role_nurse;
GRANT UPDATE (status, answer, prompt_tokens, completion_tokens, est_cost_usd, latency_ms, error) ON app.agent_runs TO role_nurse;
GRANT UPDATE (status, decided_at, outcome) ON app.agent_actions TO role_nurse;
GRANT USAGE ON SEQUENCE app.agent_runs_id_seq, app.agent_steps_id_seq, app.agent_actions_id_seq TO role_nurse;
DROP POLICY IF EXISTS runs_own ON app.agent_runs;
CREATE POLICY runs_own ON app.agent_runs FOR ALL TO role_clinician, role_executive, role_admin, role_nurse
  USING (user_id = app.current_user_id()) WITH CHECK (user_id = app.current_user_id());
DROP POLICY IF EXISTS steps_via_run ON app.agent_steps;
CREATE POLICY steps_via_run ON app.agent_steps FOR ALL TO role_clinician, role_executive, role_admin, role_nurse
  USING (EXISTS (SELECT 1 FROM app.agent_runs r WHERE r.id = run_id))
  WITH CHECK (EXISTS (SELECT 1 FROM app.agent_runs r WHERE r.id = run_id AND r.user_id = app.current_user_id()));
DROP POLICY IF EXISTS actions_own ON app.agent_actions;
CREATE POLICY actions_own ON app.agent_actions FOR ALL TO role_clinician, role_executive, role_admin, role_nurse
  USING (user_id = app.current_user_id()) WITH CHECK (user_id = app.current_user_id());

-- Notification emails about messages are logged in the same send log.
ALTER TABLE app.digest_log DROP CONSTRAINT IF EXISTS digest_log_kind_check;
ALTER TABLE app.digest_log ADD CONSTRAINT digest_log_kind_check CHECK (kind IN ('executive', 'followup', 'message'));

-- An administrator reads the agent ledger, but never what a nurse and a clinician wrote to each other. The administrator's
-- read policies on runs and actions skip the nurse's runs and the hand-off message drafts; steps follow runs through steps_via_run.
DROP POLICY IF EXISTS runs_admin_read ON app.agent_runs;
CREATE POLICY runs_admin_read ON app.agent_runs FOR SELECT TO role_admin USING (role <> 'nurse');
DROP POLICY IF EXISTS actions_admin_read ON app.agent_actions;
CREATE POLICY actions_admin_read ON app.agent_actions FOR SELECT TO role_admin USING (type <> 'handoff_message');
