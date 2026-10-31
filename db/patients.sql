-- Patient profiles: medications, readings, and guarded add/remove for the public demo.
-- Idempotent. Run as the admin database user (see api/scripts/seed_patients.ts).

ALTER TABLE clinical.patients ADD COLUMN IF NOT EXISTS diagnosed_on date;
ALTER TABLE clinical.patients ADD COLUMN IF NOT EXISTS demo_created boolean NOT NULL DEFAULT false;
ALTER TABLE clinical.patients ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();

CREATE TABLE IF NOT EXISTS clinical.patient_medications (
  med_id      serial PRIMARY KEY,
  patient_id  int  NOT NULL REFERENCES clinical.patients (patient_id) ON DELETE CASCADE,
  drug        text NOT NULL,
  drug_class  text NOT NULL CHECK (drug_class IN ('GLP-1', 'Insulin', 'DPP-4', 'Metformin')),
  indication  text NOT NULL CHECK (indication IN ('Type 2 diabetes', 'Prediabetes', 'Weight management')),
  started_on  date NOT NULL,
  stopped_on  date,
  stop_reason text,
  CHECK (stopped_on IS NULL OR stopped_on >= started_on)
);

CREATE TABLE IF NOT EXISTS clinical.patient_readings (
  reading_id serial PRIMARY KEY,
  patient_id int  NOT NULL REFERENCES clinical.patients (patient_id) ON DELETE CASCADE,
  taken_on   date NOT NULL,
  a1c        numeric(3,1),
  weight_kg  numeric(5,1),
  CHECK (a1c IS NOT NULL OR weight_kg IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS patient_medications_patient ON clinical.patient_medications (patient_id);
CREATE INDEX IF NOT EXISTS patient_readings_patient ON clinical.patient_readings (patient_id, taken_on);

COMMENT ON COLUMN clinical.patients.diagnosed_on IS 'Date the main condition was diagnosed (synthetic)';
COMMENT ON COLUMN clinical.patients.demo_created IS 'True for patients added through the demo button; only these can be removed';
COMMENT ON COLUMN clinical.patients.created_at IS 'When the row was created';
COMMENT ON TABLE clinical.patient_medications IS 'SYNTHETIC medication history: one row per prescription course, with its drug class, reason for use, start and stop dates.';
COMMENT ON COLUMN clinical.patient_medications.drug IS 'Drug name, with the brand in brackets where the brand decides the use';
COMMENT ON COLUMN clinical.patient_medications.drug_class IS 'GLP-1, Insulin, DPP-4 or Metformin, the same classes as the Medicaid data';
COMMENT ON COLUMN clinical.patient_medications.indication IS 'Why the drug was prescribed: Type 2 diabetes, Prediabetes or Weight management';
COMMENT ON COLUMN clinical.patient_medications.started_on IS 'First day of the course';
COMMENT ON COLUMN clinical.patient_medications.stopped_on IS 'Last day of the course; empty if the patient is still taking it';
COMMENT ON COLUMN clinical.patient_medications.stop_reason IS 'Why the course ended, if it did';
COMMENT ON TABLE clinical.patient_readings IS 'SYNTHETIC measurements over time: A1C (average blood sugar over about three months) and body weight.';
COMMENT ON COLUMN clinical.patient_readings.taken_on IS 'Date of the measurement';
COMMENT ON COLUMN clinical.patient_readings.a1c IS 'A1C in percent; lower is better controlled. Empty if not measured that day.';
COMMENT ON COLUMN clinical.patient_readings.weight_kg IS 'Body weight in kilograms. Empty if not measured that day.';

-- Read access: clinicians see only rows that belong to patients they can already see.
GRANT SELECT (diagnosed_on, demo_created, created_at) ON clinical.patients TO role_clinician;
GRANT SELECT ON clinical.patient_medications, clinical.patient_readings TO role_clinician;
GRANT USAGE ON SEQUENCE clinical.patient_medications_med_id_seq, clinical.patient_readings_reading_id_seq TO role_clinician;
ALTER TABLE clinical.patient_medications ENABLE ROW LEVEL SECURITY;
ALTER TABLE clinical.patient_readings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS clinician_read ON clinical.patient_medications;
CREATE POLICY clinician_read ON clinical.patient_medications FOR SELECT TO role_clinician
  USING (EXISTS (SELECT 1 FROM clinical.patients p WHERE p.patient_id = patient_medications.patient_id));
DROP POLICY IF EXISTS clinician_read ON clinical.patient_readings;
CREATE POLICY clinician_read ON clinical.patient_readings FOR SELECT TO role_clinician
  USING (EXISTS (SELECT 1 FROM clinical.patients p WHERE p.patient_id = patient_readings.patient_id));

-- Write access, demo patients only. Names are write-only: no role can read them back.
GRANT INSERT (clinic_id, full_name, birth_date, city, primary_condition, diagnosed_on, demo_created)
  ON clinical.patients TO role_clinician;
GRANT USAGE ON SEQUENCE clinical.patients_patient_id_seq TO role_clinician;
GRANT DELETE ON clinical.patients TO role_clinician;
GRANT INSERT ON clinical.patient_medications, clinical.patient_readings TO role_clinician;

DROP POLICY IF EXISTS clinician_add_demo ON clinical.patients;
CREATE POLICY clinician_add_demo ON clinical.patients FOR INSERT TO role_clinician
  WITH CHECK (demo_created AND clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::int);
DROP POLICY IF EXISTS clinician_remove_demo ON clinical.patients;
CREATE POLICY clinician_remove_demo ON clinical.patients FOR DELETE TO role_clinician
  USING (demo_created AND clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::int);

DROP POLICY IF EXISTS clinician_add_demo ON clinical.patient_medications;
CREATE POLICY clinician_add_demo ON clinical.patient_medications FOR INSERT TO role_clinician
  WITH CHECK (EXISTS (SELECT 1 FROM clinical.patients p WHERE p.patient_id = patient_medications.patient_id AND p.demo_created));
DROP POLICY IF EXISTS clinician_add_demo ON clinical.patient_readings;
CREATE POLICY clinician_add_demo ON clinical.patient_readings FOR INSERT TO role_clinician
  WITH CHECK (EXISTS (SELECT 1 FROM clinical.patients p WHERE p.patient_id = patient_readings.patient_id AND p.demo_created));

-- Hard cap so the public demo cannot be flooded: at most 30 added patients per clinic.
CREATE OR REPLACE FUNCTION clinical.cap_demo_patients() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = clinical, pg_temp AS $$
BEGIN
  IF NEW.demo_created
     AND (SELECT count(*) FROM clinical.patients WHERE demo_created AND clinic_id = NEW.clinic_id) >= 30 THEN
    RAISE EXCEPTION 'demo patient limit reached' USING ERRCODE = 'CB001';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS cap_demo_patients ON clinical.patients;
CREATE TRIGGER cap_demo_patients BEFORE INSERT ON clinical.patients
  FOR EACH ROW EXECUTE FUNCTION clinical.cap_demo_patients();

-- Carry (role_assistant) must never see patient data; nothing here grants it anything.
