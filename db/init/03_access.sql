-- serving: every role reads aggregates
GRANT SELECT ON ALL TABLES IN SCHEMA serving TO role_admin, role_clinician, role_executive;
ALTER DEFAULT PRIVILEGES IN SCHEMA serving
  GRANT SELECT ON TABLES TO role_admin, role_clinician, role_executive;

-- app: the API looks up users to log them in; admin manages users
GRANT SELECT ON app.users TO careboard_api;
GRANT SELECT, INSERT, UPDATE ON app.users TO role_admin;
GRANT USAGE ON SEQUENCE app.users_id_seq TO role_admin;

-- audit log: every role writes, only admin reads
GRANT INSERT ON app.audit_log TO role_admin, role_clinician, role_executive;
GRANT USAGE ON SEQUENCE app.audit_log_id_seq TO role_admin, role_clinician, role_executive;
GRANT SELECT ON app.audit_log TO role_admin;

-- clinical: clinicians get non-identifying columns only (no name, no birth date)...
GRANT SELECT (patient_id, clinic_id, birth_year, city, primary_condition)
  ON clinical.patients TO role_clinician;

-- ...and only the rows of their own clinic. If no clinic is set, they see nothing.
ALTER TABLE clinical.patients ENABLE ROW LEVEL SECURITY;

CREATE POLICY clinician_own_clinic ON clinical.patients
  FOR SELECT TO role_clinician
  USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::int);
