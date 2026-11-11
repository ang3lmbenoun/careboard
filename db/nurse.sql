-- Nurse (data entry) role, Part 2 stage 3. Safe to run more than once.
-- Run after the base schema, db/patients.sql and db/agents.sql.
-- A nurse can ADD patients, medications and readings for the demo in their own clinic and see a limited list of
-- those patients. A nurse cannot read names back, cannot edit or delete anything, and has no access to analytics,
-- the risk worklist, the audit log, the agent or the policy library. The database enforces all of this.

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'role_nurse') THEN
    CREATE ROLE role_nurse NOLOGIN;
  END IF;
END $$;
GRANT role_nurse TO careboard_api;
GRANT USAGE ON SCHEMA clinical, app TO role_nurse;

-- A nurse needs a clinic, like a clinician.
ALTER TABLE app.users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE app.users DROP CONSTRAINT IF EXISTS users_check;
ALTER TABLE app.users DROP CONSTRAINT IF EXISTS users_clinic_required;
ALTER TABLE app.users ADD CONSTRAINT users_role_check CHECK (role IN ('admin', 'clinician', 'executive', 'nurse'));
ALTER TABLE app.users ADD CONSTRAINT users_clinic_required CHECK (role NOT IN ('clinician', 'nurse') OR clinic_id IS NOT NULL);

CREATE OR REPLACE FUNCTION app.current_user_id() RETURNS int
LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('app.user_id', true), '')::int $$;

-- Who entered each record. The default comes from the session, and the nurse role has no INSERT right on these
-- columns, so a nurse cannot write someone else's id.
ALTER TABLE clinical.patients            ADD COLUMN IF NOT EXISTS entered_by int DEFAULT app.current_user_id();
ALTER TABLE clinical.patient_medications ADD COLUMN IF NOT EXISTS entered_by int DEFAULT app.current_user_id();
ALTER TABLE clinical.patient_readings    ADD COLUMN IF NOT EXISTS entered_by int DEFAULT app.current_user_id();

-- Plausible ranges for typed values. NOT VALID applies them to new rows without re-checking the generated history.
ALTER TABLE clinical.patient_readings DROP CONSTRAINT IF EXISTS readings_a1c_range;
ALTER TABLE clinical.patient_readings ADD CONSTRAINT readings_a1c_range CHECK (a1c IS NULL OR a1c BETWEEN 3.0 AND 20.0) NOT VALID;
ALTER TABLE clinical.patient_readings DROP CONSTRAINT IF EXISTS readings_weight_range;
ALTER TABLE clinical.patient_readings ADD CONSTRAINT readings_weight_range CHECK (weight_kg IS NULL OR weight_kg BETWEEN 20 AND 400) NOT VALID;

-- Read: a limited list of the clinic's patients. No name, no birth date, no payer.
GRANT SELECT (patient_id, clinic_id, birth_year, city, primary_condition, demo_created, created_at)
  ON clinical.patients TO role_nurse;
GRANT SELECT (med_id, patient_id, drug, drug_class, started_on, stopped_on) ON clinical.patient_medications TO role_nurse;
GRANT SELECT (reading_id, patient_id, taken_on) ON clinical.patient_readings TO role_nurse;

-- Write: add only. Column lists leave out entered_by.
GRANT INSERT (clinic_id, full_name, birth_date, city, primary_condition, diagnosed_on, demo_created, payer)
  ON clinical.patients TO role_nurse;
GRANT INSERT (patient_id, drug, drug_class, indication, started_on, stopped_on, stop_reason)
  ON clinical.patient_medications TO role_nurse;
GRANT INSERT (patient_id, taken_on, a1c, weight_kg) ON clinical.patient_readings TO role_nurse;
GRANT USAGE ON SEQUENCE clinical.patients_patient_id_seq, clinical.patient_medications_med_id_seq,
  clinical.patient_readings_reading_id_seq TO role_nurse;

-- Every action is written to the audit log; only admin can read it.
GRANT INSERT ON app.audit_log TO role_nurse;
GRANT USAGE ON SEQUENCE app.audit_log_id_seq TO role_nurse;

DROP POLICY IF EXISTS nurse_own_clinic ON clinical.patients;
CREATE POLICY nurse_own_clinic ON clinical.patients FOR SELECT TO role_nurse
  USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::int);
DROP POLICY IF EXISTS nurse_add_demo ON clinical.patients;
CREATE POLICY nurse_add_demo ON clinical.patients FOR INSERT TO role_nurse
  WITH CHECK (demo_created AND clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::int);

DROP POLICY IF EXISTS nurse_read ON clinical.patient_medications;
CREATE POLICY nurse_read ON clinical.patient_medications FOR SELECT TO role_nurse
  USING (EXISTS (SELECT 1 FROM clinical.patients p WHERE p.patient_id = patient_medications.patient_id));
DROP POLICY IF EXISTS nurse_add_demo ON clinical.patient_medications;
CREATE POLICY nurse_add_demo ON clinical.patient_medications FOR INSERT TO role_nurse
  WITH CHECK (EXISTS (SELECT 1 FROM clinical.patients p WHERE p.patient_id = patient_medications.patient_id AND p.demo_created));
DROP POLICY IF EXISTS nurse_read ON clinical.patient_readings;
CREATE POLICY nurse_read ON clinical.patient_readings FOR SELECT TO role_nurse
  USING (EXISTS (SELECT 1 FROM clinical.patients p WHERE p.patient_id = patient_readings.patient_id));
DROP POLICY IF EXISTS nurse_add_demo ON clinical.patient_readings;
CREATE POLICY nurse_add_demo ON clinical.patient_readings FOR INSERT TO role_nurse
  WITH CHECK (EXISTS (SELECT 1 FROM clinical.patients p WHERE p.patient_id = patient_readings.patient_id AND p.demo_created));

-- Demo housekeeping without a DELETE right: removes demo patients older than six hours so the per-clinic cap never
-- fills for good. Runs with the owner's rights, takes no input and touches only expired demo rows.
CREATE OR REPLACE FUNCTION clinical.expire_demo_patients() RETURNS int
LANGUAGE sql SECURITY DEFINER SET search_path = clinical, pg_temp AS $$
  WITH d AS (DELETE FROM clinical.patients WHERE demo_created AND created_at < now() - interval '6 hours' RETURNING 1)
  SELECT count(*)::int FROM d
$$;
REVOKE ALL ON FUNCTION clinical.expire_demo_patients() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION clinical.expire_demo_patients() TO role_nurse, role_clinician;

COMMENT ON ROLE role_nurse IS 'Data entry: can add demo patients, medications and readings in its own clinic; cannot read names, analytics, risk, audit or agent data.';
COMMENT ON COLUMN clinical.patients.entered_by IS 'User id of whoever entered the row (set by the database from the session; empty for generated history).';
