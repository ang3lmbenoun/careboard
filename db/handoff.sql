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
