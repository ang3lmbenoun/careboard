-- Risk and compliance layer for CareBoard. Idempotent: safe to run more than once.
-- Run as the admin database user (see api/scripts/apply_risk.ts). Needs db/patients.sql applied first.
-- Requires Postgres 15 or newer (security_invoker views).

-- ---------------------------------------------------------------------------------------------
-- 1. Failed sign-ins can be recorded. The API login may INSERT into the audit log and nothing else.
-- ---------------------------------------------------------------------------------------------
GRANT INSERT ON app.audit_log TO careboard_api;
GRANT USAGE ON SEQUENCE app.audit_log_id_seq TO careboard_api;

-- Tightening found by the control tests below: the admin role could read password hashes.
-- Admin keeps the right to change a user, but can no longer read the hash column.
REVOKE SELECT ON app.users FROM role_admin;
GRANT SELECT (id, email, display_name, role, clinic_id) ON app.users TO role_admin;

-- ---------------------------------------------------------------------------------------------
-- 2. Risk register and control map (reference data, written by the project author).
-- ---------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS app.control_map (
  control_id     text PRIMARY KEY,
  name           text NOT NULL,
  safeguard_type text NOT NULL CHECK (safeguard_type IN ('Administrative', 'Technical', 'Physical')),
  hipaa_ref      text NOT NULL,
  how_implemented text NOT NULL,
  status         text NOT NULL CHECK (status IN ('Implemented', 'Partial', 'Gap', 'Inherited')),
  how_to_verify  text NOT NULL
);

CREATE TABLE IF NOT EXISTS app.risk_register (
  risk_id             text PRIMARY KEY,
  category            text NOT NULL,
  title               text NOT NULL,
  description         text NOT NULL,
  inherent_likelihood int  NOT NULL CHECK (inherent_likelihood BETWEEN 1 AND 5),
  inherent_impact     int  NOT NULL CHECK (inherent_impact BETWEEN 1 AND 5),
  inherent_score      int  GENERATED ALWAYS AS (inherent_likelihood * inherent_impact) STORED,
  controls            text[] NOT NULL DEFAULT '{}',
  control_summary     text NOT NULL,
  residual_likelihood int  NOT NULL CHECK (residual_likelihood BETWEEN 1 AND 5),
  residual_impact     int  NOT NULL CHECK (residual_impact BETWEEN 1 AND 5),
  residual_score      int  GENERATED ALWAYS AS (residual_likelihood * residual_impact) STORED,
  status              text NOT NULL CHECK (status IN ('Mitigated', 'Monitoring', 'Accepted', 'Open')),
  owner               text NOT NULL,
  next_step           text NOT NULL
);

COMMENT ON TABLE app.control_map IS 'Controls in CareBoard mapped to HIPAA Security Rule safeguard areas, with how to verify each. Written by the project author; a learning exercise, not a compliance certification.';
COMMENT ON TABLE app.risk_register IS 'Risks with likelihood and impact (1 to 5) before and after controls. Scores are the author''s judgment on a 5x5 matrix, not measurements.';

TRUNCATE app.control_map, app.risk_register;

INSERT INTO app.control_map (control_id, name, safeguard_type, hipaa_ref, how_implemented, status, how_to_verify) VALUES
('C01', 'Role-based access in the database', 'Technical', '164.312(a)(1) Access control; 164.308(a)(4) Information access management',
 'Three NOLOGIN roles (admin, clinician, executive) hold the privileges. The API login has none of its own and switches into one role per request, so the database decides what each person may read.', 'Implemented',
 'Data catalog: locked columns show LOCKED. Control test "API login holds no privileges of its own" on the Risk and compliance page (admin view).'),
('C02', 'Row-level security by clinic', 'Technical', '164.312(a)(1) Access control; 164.502(b) Minimum necessary',
 'Policies on the patient tables limit a clinician to patients of their own clinic. With no clinic set, they see nothing.', 'Implemented',
 'Control test "Row-level security is on for every patient table" on the Risk and compliance page (admin view). Sign in as a clinician: only one clinic''s patients appear.'),
('C03', 'Column grants hide direct identifiers', 'Technical', '164.502(b) Minimum necessary; 164.514 De-identification concepts',
 'full_name and birth_date are readable by no role. The demo can write names but nothing can read them back.', 'Implemented',
 'Control test "No role can read names or birth dates" on the Risk and compliance page (admin view).'),
('C04', 'Audit trail', 'Technical', '164.312(b) Audit controls; 164.308(a)(1)(ii)(D) Information system activity review',
 'Every sign-in, failed sign-in, data view, denied request, patient add/remove and assistant question is written to app.audit_log. Roles can insert; only admin can read; nobody can update or delete through the app.', 'Implemented',
 'Audit log page. Control test "Audit log cannot be edited by app roles" on the Risk and compliance page (admin view).'),
('C05', 'Unique user identification', 'Technical', '164.312(a)(2)(i) Unique user identification; 164.312(d) Person or entity authentication',
 'Each person has their own account with a bcrypt password hash. Every audit row carries the user id.', 'Partial',
 'Audit log "Who" column. Gap: demo accounts share a published password, and there is no multi-factor sign-in.'),
('C06', 'Sign-in throttling', 'Technical', '164.312(d) Person or entity authentication',
 'The sign-in route is limited to 30 attempts per 15 minutes per IP address. Failed attempts are logged without storing what was typed.', 'Partial',
 'Security metrics: failed sign-ins. Gap: no per-account lockout.'),
('C07', 'Session expiry', 'Technical', '164.312(a)(2)(iii) Automatic logoff (addressable)',
 'Sign-in tokens expire after 8 hours. There is no idle timeout and no way to revoke a token early.', 'Partial',
 'Read api/src/server.ts (expiresIn). Gap: no idle logoff or revocation.'),
('C08', 'Encryption in transit', 'Technical', '164.312(e)(1) Transmission security',
 'The live site is served over HTTPS by the hosting provider, and the database connection uses TLS.', 'Inherited',
 'Open the live site: the address starts with https. Provided by Render and Neon; I have not audited their configuration.'),
('C09', 'Encryption at rest and physical safeguards', 'Physical', '164.310 Physical safeguards; 164.312(a)(2)(iv) Encryption (addressable)',
 'Handled by the cloud providers hosting the database and web service. CareBoard adds nothing of its own.', 'Inherited',
 'Not verified by this project. Would need the providers'' compliance documents.'),
('C10', 'Read-only, narrow role for the AI assistant', 'Technical', '164.312(a)(1) Access control; 164.502(b) Minimum necessary',
 'Carry runs as role_assistant: read-only, two summary tables, five-second timeout, SQL checked before it runs. It has no access to patient, user or audit tables.', 'Implemented',
 'Control test "The assistant role cannot reach patient, user or audit data" on the Risk and compliance page (admin view). Ask Carry for patient names: it refuses.'),
('C11', 'Minimum cell size on shared aggregates', 'Technical', '164.502(b) Minimum necessary; 164.514 De-identification concepts',
 'Patient counts shown to executives and admins are hidden when a clinic-and-condition group has fewer than 5 patients. If either risk band in a group has fewer than 5, both bands are hidden, so the hidden number cannot be calculated by subtraction.', 'Implemented',
 'Care risk page as executive: some cells show "fewer than 5". Test in the sandbox with a small group.'),
('C12', 'Limits on demo data entry', 'Technical', '164.312(c)(1) Integrity',
 'Clinicians can add and remove only demo patients, in their own clinic, at most 30 per clinic, enforced by a trigger and row-level policies. No free text is accepted.', 'Implemented',
 'Patients page: add 31 patients and the limit message appears; seeded patients cannot be removed.'),
('C13', 'Data quality checks', 'Administrative', '164.312(c)(1) Integrity; 164.308(a)(1)(ii)(A) Risk analysis',
 'Row counts, reconciliation and freshness checks run live on the Risk and compliance page.', 'Implemented',
 'Risk and compliance page, Data health section.'),
('C14', 'Documented risk analysis and management', 'Administrative', '164.308(a)(1)(ii)(A) Risk analysis; 164.308(a)(1)(ii)(B) Risk management',
 'This risk register, reviewed by the project author. It is a learning exercise with no external review.', 'Partial',
 'Risk register on the Risk and compliance page (admin view). Gap: no independent review and no review schedule.'),
('C15', 'Workforce training and sanctions', 'Administrative', '164.308(a)(5) Security awareness and training; 164.308(a)(1)(ii)(C) Sanction policy',
 'Not applicable to a one-person portfolio project.', 'Gap',
 'Would be required in a real organization.');

INSERT INTO app.risk_register (risk_id, category, title, description, inherent_likelihood, inherent_impact, controls, control_summary, residual_likelihood, residual_impact, status, owner, next_step) VALUES
('R01', 'Privacy', 'Patient identity exposed through the API', 'A query or a bug returns patient names or birth dates.', 4, 5,
 '{C01,C03}', 'Names and birth dates are not granted to any role, so no query can return them.', 1, 5, 'Mitigated', 'Admin', 'Keep the control test green after every schema change.'),
('R02', 'Access control', 'A clinician sees another clinic''s patients', 'Missing filter or a wrong role lets one clinic read another clinic''s patients.', 4, 5,
 '{C01,C02}', 'Row-level security enforces the clinic in the database, not in the application.', 1, 5, 'Mitigated', 'Admin', 'Add a regression test that signs in as each clinic and compares row sets.'),
('R03', 'Access control', 'The API login becomes a path to full access', 'If the API login held its own privileges, any bug in the API would expose everything.', 3, 5,
 '{C01}', 'The API login is NOINHERIT with no privileges of its own, and switches role per request.', 1, 5, 'Mitigated', 'Admin', 'None while the control test stays green.'),
('R04', 'AI assistant', 'AI-written SQL does harm', 'The model writes a query that modifies data, reads restricted tables or runs too long.', 4, 4,
 '{C10}', 'Read-only role on two tables, SQL checker, five-second timeout, daily cap.', 1, 3, 'Mitigated', 'Admin', 'Re-run the Carry safety questions after every prompt change.'),
('R05', 'AI assistant', 'Patient data reaches the AI provider', 'Patient-level data is sent to the third-party model provider inside a question or result.', 3, 5,
 '{C10}', 'Carry cannot read patient data, so none can be sent. The only risk left is a user typing personal details into the question box.', 2, 4, 'Monitoring', 'Admin', 'Add a short warning under the Carry input: do not type personal information.'),
('R06', 'Authentication', 'Passwords guessed or reused', 'An attacker repeatedly tries passwords on the sign-in page.', 4, 3,
 '{C05,C06}', 'Throttle of 30 attempts per 15 minutes per IP, bcrypt hashes, failed attempts logged.', 3, 3, 'Open', 'Admin', 'Add per-account lockout and multi-factor sign-in before any real use.'),
('R07', 'Authentication', 'Shared demo credentials are public', 'The demo accounts and password are published so recruiters can try the app.', 5, 2,
 '{C03,C12}', 'Accepted on purpose: all patient data is synthetic and demo actions are capped.', 5, 2, 'Accepted', 'Executive', 'Reconsider only if real data is ever loaded.'),
('R08', 'Integrity', 'Public demo is filled with junk records', 'Visitors add patients until storage fills or the list becomes unusable.', 4, 2,
 '{C12}', 'Database trigger caps demo patients at 30 per clinic, add and remove are rate limited, demo rows expire after 6 hours.', 2, 2, 'Mitigated', 'Admin', 'Watch the add/remove counts in Security metrics.'),
('R09', 'Authentication', 'A sign-in token is stolen or left open', 'Someone reuses an unlocked browser or a copied token.', 3, 3,
 '{C07}', 'Tokens expire after 8 hours. They cannot be revoked early.', 3, 3, 'Open', 'Admin', 'Shorten the lifetime and add an idle timeout.'),
('R10', 'Audit', 'Audit trail is missing or altered', 'Access cannot be reconstructed after an incident.', 3, 4,
 '{C04}', 'App roles can only insert; failed sign-ins and denied requests are now logged too. The database owner can still change rows.', 2, 4, 'Monitoring', 'Admin', 'Ship the log to storage the database owner cannot edit.'),
('R11', 'Data quality', 'Stale or inconsistent data drives a wrong decision', 'A load fails silently, or totals no longer add up, and nobody notices.', 3, 3,
 '{C13}', 'Live reconciliation and freshness checks on the Risk and compliance page.', 2, 3, 'Monitoring', 'Admin', 'Run the checks on a schedule and alert on failure.'),
('R12', 'Compliance', 'Synthetic data mistaken for real or clinical advice', 'A reader treats invented patients, illustrative scores or scenario numbers as real findings.', 3, 4,
 '{C14}', 'Every synthetic dataset, assumption and illustrative score is labeled on the page where it appears.', 2, 4, 'Monitoring', 'Admin', 'Keep labels in every new page and in the README.'),
('R13', 'Privacy', 'Small groups identify individuals', 'An aggregate with very few patients lets a reader work out who is in it.', 3, 4,
 '{C11}', 'Groups and risk bands under 5 patients are hidden, and a second number is hidden when needed so it cannot be calculated by subtraction.', 1, 4, 'Mitigated', 'Admin', 'Revisit the threshold if the clinics grow or more breakdowns are added.'),
('R14', 'Availability', 'Free-tier services sleep or fail', 'The web service or database is slow to wake or unavailable when someone opens the demo.', 4, 2,
 '{}', 'Accepted: the first load can take about a minute. No redundancy.', 4, 2, 'Accepted', 'Executive', 'Mention the delay in the README.'),
('R15', 'Financial', 'Medicaid spend is concentrated in one drug class', 'One class (GLP-1) accounts for most of the spend, so a price or coverage change moves the total sharply.', 4, 4,
 '{}', 'Monitored on the Financial exposure page with a concentration index and scenarios. Not mitigated: this is a business exposure.', 4, 4, 'Monitoring', 'Executive', 'Decide a spend-share threshold that triggers review.'),
('R16', 'Operational', 'No-shows leak revenue', 'Missed appointments cost visits that cannot be refilled, and one department drifts worse over time.', 4, 3,
 '{}', 'Monitored on the Operational risk page with revenue at risk by department and weekday.', 4, 3, 'Monitoring', 'Executive', 'Test reminders for the department with the highest rate.');

-- ---------------------------------------------------------------------------------------------
-- 3. Data classification: one sensitivity label per column, shown in the data catalog.
-- ---------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS app.data_classification (
  object_schema text NOT NULL,
  object_name   text NOT NULL,
  column_name   text NOT NULL DEFAULT '*',  -- '*' means the whole table unless a column row overrides it
  label         text NOT NULL CHECK (label IN ('Public data', 'Synthetic aggregate', 'Health information', 'Indirect identifier',
                                               'Direct identifier', 'Credential', 'Activity log', 'Governance', 'Operational')),
  PRIMARY KEY (object_schema, object_name, column_name)
);
COMMENT ON TABLE app.data_classification IS 'Sensitivity label for each table or column, used by the data catalog.';

TRUNCATE app.data_classification;
INSERT INTO app.data_classification VALUES
('serving', 'medicaid_drug_quarterly', '*', 'Public data'),
('serving', 'clinic_daily', '*', 'Synthetic aggregate'),
('clinical', 'patients', '*', 'Health information'),
('clinical', 'patients', 'patient_id', 'Indirect identifier'),
('clinical', 'patients', 'clinic_id', 'Indirect identifier'),
('clinical', 'patients', 'birth_year', 'Indirect identifier'),
('clinical', 'patients', 'city', 'Indirect identifier'),
('clinical', 'patients', 'full_name', 'Direct identifier'),
('clinical', 'patients', 'birth_date', 'Direct identifier'),
('clinical', 'patients', 'demo_created', 'Operational'),
('clinical', 'patients', 'created_at', 'Operational'),
('clinical', 'patient_medications', '*', 'Health information'),
('clinical', 'patient_medications', 'med_id', 'Operational'),
('clinical', 'patient_medications', 'patient_id', 'Indirect identifier'),
('clinical', 'patient_readings', '*', 'Health information'),
('clinical', 'patient_readings', 'reading_id', 'Operational'),
('clinical', 'patient_readings', 'patient_id', 'Indirect identifier'),
('clinical', 'care_risk', '*', 'Health information'),
('clinical', 'care_risk', 'patient_id', 'Indirect identifier'),
('clinical', 'care_risk', 'clinic_id', 'Indirect identifier'),
('app', 'users', '*', 'Operational'),
('app', 'users', 'email', 'Direct identifier'),
('app', 'users', 'display_name', 'Direct identifier'),
('app', 'users', 'password_hash', 'Credential'),
('app', 'audit_log', '*', 'Activity log'),
('app', 'risk_register', '*', 'Governance'),
('app', 'control_map', '*', 'Governance'),
('app', 'data_classification', '*', 'Governance');

GRANT SELECT ON app.risk_register, app.control_map TO role_admin, role_executive;
GRANT SELECT ON app.data_classification TO role_admin, role_clinician, role_executive;

-- ---------------------------------------------------------------------------------------------
-- 4. Care risk score for patients. A view that runs with the CALLER's rights (security_invoker),
--    so row-level security and column grants apply exactly as they do on the patient tables.
--    The rules are illustrative, loosely modeled on common diabetes quality measures. Not clinical guidance.
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION clinical.risk_reference_date() RETURNS date
LANGUAGE sql IMMUTABLE AS $$ SELECT DATE '2026-10-28' $$;
COMMENT ON FUNCTION clinical.risk_reference_date() IS 'The date the synthetic patients were generated. A real pipeline would use the load date.';

DROP VIEW IF EXISTS clinical.care_risk;
CREATE VIEW clinical.care_risk WITH (security_invoker = true) AS
WITH rd AS (
  SELECT patient_id,
    (array_agg(a1c ORDER BY taken_on DESC) FILTER (WHERE a1c IS NOT NULL))[1] AS a1c_latest,
    (array_agg(a1c ORDER BY taken_on DESC) FILTER (WHERE a1c IS NOT NULL))[2] AS a1c_prev,
    max(taken_on) FILTER (WHERE a1c IS NOT NULL) AS a1c_on,
    (array_agg(weight_kg ORDER BY taken_on DESC) FILTER (WHERE weight_kg IS NOT NULL))[1] AS w_latest,
    (array_agg(weight_kg ORDER BY taken_on DESC) FILTER (WHERE weight_kg IS NOT NULL))[3] AS w_earlier,
    max(taken_on) AS last_reading
  FROM clinical.patient_readings GROUP BY patient_id
), glp AS (
  SELECT DISTINCT ON (patient_id) patient_id, stopped_on AS glp1_stopped_on, stop_reason AS glp1_stop_reason
  FROM clinical.patient_medications
  WHERE drug_class = 'GLP-1' AND stopped_on IS NOT NULL
  ORDER BY patient_id, stopped_on DESC
), act AS (
  SELECT patient_id,
    bool_or(drug_class = 'GLP-1' AND stopped_on IS NULL) AS on_glp1,
    max(started_on) FILTER (WHERE drug_class = 'Insulin') AS insulin_started
  FROM clinical.patient_medications GROUP BY patient_id
), feat AS (
  SELECT p.patient_id, p.clinic_id, p.primary_condition, p.demo_created,
         rd.a1c_latest, rd.a1c_prev, rd.a1c_on, rd.w_latest, rd.w_earlier,
         GREATEST(clinical.risk_reference_date(), COALESCE(rd.last_reading, clinical.risk_reference_date())) AS ref,
         glp.glp1_stopped_on, glp.glp1_stop_reason, COALESCE(act.on_glp1, false) AS on_glp1, act.insulin_started
  FROM clinical.patients p
  LEFT JOIN rd USING (patient_id) LEFT JOIN glp USING (patient_id) LEFT JOIN act USING (patient_id)
), scored AS (
  SELECT f.*, (f.ref - f.a1c_on) AS days_since_a1c, s.points, s.reasons
  FROM feat f
  CROSS JOIN LATERAL (
    SELECT COALESCE(sum(v.pts), 0)::int AS points,
           COALESCE(array_agg(v.txt ORDER BY v.pts DESC, v.ord) FILTER (WHERE v.pts > 0), '{}') AS reasons
    FROM (VALUES
      (1, CASE WHEN f.a1c_latest >= 9 THEN 3 WHEN f.a1c_latest >= 8 THEN 1 ELSE 0 END,
          CASE WHEN f.a1c_latest >= 9 THEN 'A1C ' || f.a1c_latest || '% (9 or higher)'
               ELSE 'A1C ' || f.a1c_latest || '% (8 to 8.9)' END),
      (2, CASE WHEN f.a1c_on IS NULL THEN 2
               WHEN (f.ref - f.a1c_on) > CASE WHEN f.primary_condition = 'Type 2 diabetes' THEN 180 ELSE 365 END THEN 2
               ELSE 0 END,
          CASE WHEN f.a1c_on IS NULL THEN 'No A1C on record'
               ELSE 'No A1C for ' || round((f.ref - f.a1c_on) / 30.4)::int || ' months' END),
      (3, CASE WHEN f.a1c_latest - f.a1c_prev >= 0.5 THEN 1 ELSE 0 END,
          'A1C rose ' || round(f.a1c_latest - f.a1c_prev, 1) || ' points since the last reading'),
      (4, CASE WHEN f.glp1_stopped_on >= f.ref - 180 AND NOT f.on_glp1 THEN 1 ELSE 0 END,
          'GLP-1 stopped ' || round((f.ref - f.glp1_stopped_on) / 30.4)::int || ' months ago' ||
            COALESCE(' (' || lower(f.glp1_stop_reason) || ')', '')),
      (5, CASE WHEN f.insulin_started >= f.ref - 365 THEN 1 ELSE 0 END,
          'Started insulin in the last year'),
      (6, CASE WHEN f.w_latest >= f.w_earlier * 1.03 THEN 1 ELSE 0 END,
          'Weight up ' || round((f.w_latest / NULLIF(f.w_earlier, 0) - 1) * 100, 1) || '% over about 6 months')
    ) AS v(ord, pts, txt)
  ) s
)
SELECT patient_id, clinic_id, primary_condition, demo_created,
       a1c_latest AS latest_a1c, a1c_on AS latest_a1c_on, days_since_a1c,
       round(a1c_latest - a1c_prev, 1) AS a1c_change,
       points,
       CASE WHEN points >= 3 THEN 'High' WHEN points >= 2 THEN 'Medium' ELSE 'Low' END AS tier,
       reasons
FROM scored;

COMMENT ON VIEW clinical.care_risk IS 'ILLUSTRATIVE risk points per patient from simple rules (A1C level and trend, overdue A1C, GLP-1 stopped, new insulin, weight gain). Runs with the caller''s rights, so clinicians see only their own clinic. Not clinical guidance.';
COMMENT ON COLUMN clinical.care_risk.points IS 'Sum of rule points; 3 or more is High, 2 is Medium, otherwise Low';
COMMENT ON COLUMN clinical.care_risk.tier IS 'Low, Medium or High, from points';
COMMENT ON COLUMN clinical.care_risk.reasons IS 'The rules that fired, in plain words';
COMMENT ON COLUMN clinical.care_risk.latest_a1c IS 'Most recent A1C in percent';
COMMENT ON COLUMN clinical.care_risk.days_since_a1c IS 'Days from the reference date to the latest A1C';
COMMENT ON COLUMN clinical.care_risk.a1c_change IS 'Latest A1C minus the one before it, in percentage points';

GRANT SELECT ON clinical.care_risk TO role_clinician;

-- ---------------------------------------------------------------------------------------------
-- 5. Care risk summary for executives and admins: counts by clinic and condition, small cells hidden.
--    SECURITY DEFINER because those roles have no access to patient tables; it returns counts only.
--    Seeded patients only, so demo-added patients cannot change what executives see.
--    Rules: a group under the minimum size shows nothing. In a larger group, if either band (elevated, low)
--    is under the minimum, both bands are hidden, because the hidden one could be calculated from the total.
-- ---------------------------------------------------------------------------------------------
DROP FUNCTION IF EXISTS app.care_risk_summary(int);
CREATE FUNCTION app.care_risk_summary(min_cell int DEFAULT 5)
RETURNS TABLE (clinic_id int, condition text, patients int, elevated int, low int, patients_hidden boolean, bands_hidden boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  WITH g AS (
    SELECT r.clinic_id AS cid, r.primary_condition AS cond, count(*)::int AS n,
           (count(*) FILTER (WHERE r.tier IN ('High', 'Medium')))::int AS elev
    FROM clinical.care_risk r WHERE NOT r.demo_created
    GROUP BY r.clinic_id, r.primary_condition
  )
  SELECT cid, cond,
         CASE WHEN n < min_cell THEN NULL ELSE n END,
         CASE WHEN n < min_cell OR elev < min_cell OR n - elev < min_cell THEN NULL ELSE elev END,
         CASE WHEN n < min_cell OR elev < min_cell OR n - elev < min_cell THEN NULL ELSE n - elev END,
         n < min_cell,
         (n < min_cell OR elev < min_cell OR n - elev < min_cell)
  FROM g ORDER BY cid, n DESC, cond
$$;
COMMENT ON FUNCTION app.care_risk_summary(int) IS 'Patient counts by clinic and condition, split into elevated (Medium or High) and low risk, with small cells hidden.';
REVOKE ALL ON FUNCTION app.care_risk_summary(int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.care_risk_summary(int) TO role_admin, role_executive;

-- ---------------------------------------------------------------------------------------------
-- 6. Data health and control tests. These run live; each row is a real check against the database.
--    SECURITY DEFINER because the checks must see tables the admin role cannot read. They return counts and
--    pass/fail only, never rows.
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.data_inventory()
RETURNS TABLE (dataset text, row_count bigint, latest text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT 'serving.medicaid_drug_quarterly', count(*), max(year::text || ' Q' || quarter::text) FROM serving.medicaid_drug_quarterly
  UNION ALL SELECT 'serving.clinic_daily', count(*), max(day)::text FROM serving.clinic_daily
  UNION ALL SELECT 'clinical.patients', count(*), max(created_at)::date::text FROM clinical.patients
  UNION ALL SELECT 'clinical.patient_medications', count(*), max(started_on)::text FROM clinical.patient_medications
  UNION ALL SELECT 'clinical.patient_readings', count(*), max(taken_on)::text FROM clinical.patient_readings
  UNION ALL SELECT 'app.users', count(*), NULL FROM app.users
  UNION ALL SELECT 'app.audit_log', count(*), max(at)::date::text FROM app.audit_log
$$;

CREATE OR REPLACE FUNCTION app.data_checks()
RETURNS TABLE (area text, name text, status text, detail text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE n bigint; d date; q int;
BEGIN
  -- Clinic activity
  SELECT count(*) INTO n FROM serving.clinic_daily WHERE completed + no_shows <> scheduled OR no_shows < 0 OR completed < 0;
  area := 'Clinic activity'; name := 'Completed + no-shows equals scheduled';
  status := CASE WHEN n = 0 THEN 'pass' ELSE 'fail' END; detail := n || ' rows break the rule'; RETURN NEXT;

  SELECT max(day) INTO d FROM serving.clinic_daily;
  name := 'Data is recent';
  status := CASE WHEN d IS NULL THEN 'fail' WHEN current_date - d <= 60 THEN 'pass' ELSE 'warn' END;
  detail := 'Latest day ' || COALESCE(d::text, 'none') || ' (' || COALESCE((current_date - d)::text, '?') || ' days ago). This is a fixed synthetic dataset, so a warning appears as time passes.'; RETURN NEXT;

  -- Medicaid
  SELECT count(*) INTO n FROM serving.medicaid_drug_quarterly WHERE spend IS NULL OR spend < 0 OR prescriptions < 0;
  area := 'Medicaid spend'; name := 'No missing or negative amounts';
  status := CASE WHEN n = 0 THEN 'pass' ELSE 'fail' END; detail := n || ' rows with a missing or negative value'; RETURN NEXT;

  SELECT count(DISTINCT (year, quarter)) INTO q FROM serving.medicaid_drug_quarterly;
  name := 'Four quarters present';
  status := CASE WHEN q = 4 THEN 'pass' ELSE 'warn' END; detail := q || ' distinct quarters loaded'; RETURN NEXT;

  SELECT count(*) INTO n FROM serving.medicaid_drug_quarterly WHERE spend > 0 AND COALESCE(prescriptions, 0) = 0;
  name := 'Spend always has a prescription count';
  status := CASE WHEN n = 0 THEN 'pass' ELSE 'warn' END;
  detail := n || ' rows have spend but no prescription count (the source hides small counts)'; RETURN NEXT;

  -- Patients
  SELECT count(*) INTO n FROM clinical.patients p WHERE NOT EXISTS (SELECT 1 FROM clinical.patient_readings r WHERE r.patient_id = p.patient_id);
  area := 'Patient records'; name := 'Every patient has at least one reading';
  status := CASE WHEN n = 0 THEN 'pass' ELSE 'fail' END; detail := n || ' patients without readings'; RETURN NEXT;

  SELECT count(*) INTO n FROM (
    SELECT patient_id FROM clinical.patient_medications EXCEPT SELECT patient_id FROM clinical.patients) x;
  name := 'No medication rows without a patient';
  status := CASE WHEN n = 0 THEN 'pass' ELSE 'fail' END; detail := n || ' orphan patients in medications'; RETURN NEXT;

  SELECT COALESCE(max(c), 0) INTO n FROM (SELECT count(*) AS c FROM clinical.patients WHERE demo_created GROUP BY clinic_id) x;
  name := 'Demo patient cap respected';
  status := CASE WHEN n <= 30 THEN 'pass' ELSE 'fail' END; detail := 'Largest demo group: ' || n || ' (limit 30)'; RETURN NEXT;

  SELECT count(*) INTO n FROM app.audit_log a WHERE a.user_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM app.users u WHERE u.id = a.user_id);
  area := 'Audit log'; name := 'Every audit row points to a real user (or none)';
  status := CASE WHEN n = 0 THEN 'pass' ELSE 'warn' END; detail := n || ' rows point to a missing user'; RETURN NEXT;
END $$;

CREATE OR REPLACE FUNCTION app.control_tests()
RETURNS TABLE (name text, status text, detail text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE r text; bad text[]; n int;
BEGIN
  -- No role can read direct identifiers.
  bad := '{}';
  FOR r IN SELECT rolname FROM pg_roles WHERE rolname = ANY (ARRAY['role_admin','role_clinician','role_executive','role_assistant','careboard_api']) LOOP
    IF (
        has_column_privilege(r, 'clinical.patients', 'full_name', 'SELECT')
     OR has_column_privilege(r, 'clinical.patients', 'birth_date', 'SELECT')) THEN bad := bad || r; END IF;
  END LOOP;
  name := 'No role can read names or birth dates';
  status := CASE WHEN cardinality(bad) = 0 THEN 'pass' ELSE 'fail' END;
  detail := CASE WHEN cardinality(bad) = 0 THEN 'Checked admin, clinician, executive, assistant and API login' ELSE 'Readable by: ' || array_to_string(bad, ', ') END; RETURN NEXT;

  -- Row-level security on.
  SELECT count(*) INTO n FROM pg_class c JOIN pg_namespace s ON s.oid = c.relnamespace
   WHERE s.nspname = 'clinical' AND c.relname IN ('patients','patient_medications','patient_readings') AND NOT c.relrowsecurity;
  name := 'Row-level security is on for every patient table';
  status := CASE WHEN n = 0 THEN 'pass' ELSE 'fail' END; detail := n || ' of 3 patient tables without row-level security'; RETURN NEXT;

  -- API login holds no power of its own.
  SELECT count(*) INTO n FROM pg_roles WHERE rolname = 'careboard_api' AND (rolsuper OR rolbypassrls OR rolinherit OR rolcreaterole OR rolcreatedb);
  name := 'API login holds no privileges of its own';
  status := CASE WHEN n = 0 THEN 'pass' ELSE 'fail' END;
  detail := CASE WHEN n = 0 THEN 'No superuser, no row-security bypass, no inherited privileges' ELSE 'API login has elevated attributes' END; RETURN NEXT;

  -- Audit log cannot be edited.
  bad := '{}';
  FOR r IN SELECT rolname FROM pg_roles WHERE rolname = ANY (ARRAY['role_admin','role_clinician','role_executive','role_assistant','careboard_api']) LOOP
    IF (
        has_table_privilege(r, 'app.audit_log', 'UPDATE') OR has_table_privilege(r, 'app.audit_log', 'DELETE')
        OR has_table_privilege(r, 'app.audit_log', 'TRUNCATE')) THEN bad := bad || r; END IF;
  END LOOP;
  name := 'Audit log cannot be edited by app roles';
  status := CASE WHEN cardinality(bad) = 0 THEN 'pass' ELSE 'fail' END;
  detail := CASE WHEN cardinality(bad) = 0 THEN 'No update, delete or truncate right for any app role' ELSE 'Can edit: ' || array_to_string(bad, ', ') END; RETURN NEXT;

  -- Audit log readable only by admin.
  bad := '{}';
  FOR r IN SELECT rolname FROM pg_roles WHERE rolname = ANY (ARRAY['role_clinician','role_executive','role_assistant','careboard_api']) LOOP
    IF has_table_privilege(r, 'app.audit_log', 'SELECT') THEN bad := bad || r; END IF;
  END LOOP;
  name := 'Only admin can read the audit log';
  status := CASE WHEN cardinality(bad) = 0 THEN 'pass' ELSE 'fail' END;
  detail := CASE WHEN cardinality(bad) = 0 THEN 'Clinician, executive, assistant and API login are denied' ELSE 'Can read: ' || array_to_string(bad, ', ') END; RETURN NEXT;

  -- Password hashes unreadable by app roles.
  bad := '{}';
  FOR r IN SELECT rolname FROM pg_roles WHERE rolname = ANY (ARRAY['role_admin','role_clinician','role_executive','role_assistant']) LOOP
    IF has_column_privilege(r, 'app.users', 'password_hash', 'SELECT') THEN bad := bad || r; END IF;
  END LOOP;
  name := 'Password hashes are not readable by app roles';
  status := CASE WHEN cardinality(bad) = 0 THEN 'pass' ELSE 'fail' END;
  detail := CASE WHEN cardinality(bad) = 0 THEN 'Only the API login can read them, to check a sign-in' ELSE 'Readable by: ' || array_to_string(bad, ', ') END; RETURN NEXT;

  -- Carry cannot reach restricted data.
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'role_assistant') THEN
    bad := '{}';
    IF has_schema_privilege('role_assistant', 'clinical', 'USAGE') THEN bad := bad || 'clinical schema'; END IF;
    IF has_schema_privilege('role_assistant', 'app', 'USAGE') THEN bad := bad || 'app schema'; END IF;
    IF has_table_privilege('role_assistant', 'clinical.patient_medications', 'SELECT') THEN bad := bad || 'medications'; END IF;
    IF has_table_privilege('role_assistant', 'app.audit_log', 'SELECT') THEN bad := bad || 'audit log'; END IF;
    IF has_table_privilege('role_assistant', 'app.risk_register', 'SELECT') THEN bad := bad || 'risk register'; END IF;
    name := 'The assistant role cannot reach patient, user or audit data';
    status := CASE WHEN cardinality(bad) = 0 THEN 'pass' ELSE 'fail' END;
    detail := CASE WHEN cardinality(bad) = 0 THEN 'No access to the clinical or app schemas' ELSE 'Can reach: ' || array_to_string(bad, ', ') END; RETURN NEXT;
  END IF;

  -- Executives cannot read patient tables.
  bad := '{}';
  FOR r IN SELECT rolname FROM pg_roles WHERE rolname IN ('role_executive','role_admin') LOOP
    IF has_table_privilege(r, 'clinical.patient_readings', 'SELECT') OR has_column_privilege(r, 'clinical.patients', 'primary_condition', 'SELECT') THEN bad := bad || r; END IF;
  END LOOP;
  name := 'Executive and admin roles cannot read patient rows';
  status := CASE WHEN cardinality(bad) = 0 THEN 'pass' ELSE 'fail' END;
  detail := CASE WHEN cardinality(bad) = 0 THEN 'They see patient counts only, through a function with small cells hidden' ELSE 'Can read: ' || array_to_string(bad, ', ') END; RETURN NEXT;
END $$;

REVOKE ALL ON FUNCTION app.data_inventory(), app.data_checks(), app.control_tests() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.data_inventory(), app.data_checks(), app.control_tests() TO role_admin;
