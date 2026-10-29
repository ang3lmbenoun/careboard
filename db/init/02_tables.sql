CREATE TABLE app.users (
  id            serial PRIMARY KEY,
  email         text UNIQUE NOT NULL,
  display_name  text NOT NULL,
  password_hash text,
  role          text NOT NULL CHECK (role IN ('admin', 'clinician', 'executive')),
  clinic_id     int,
  CHECK (role <> 'clinician' OR clinic_id IS NOT NULL)
);

CREATE TABLE app.audit_log (
  id      bigserial PRIMARY KEY,
  at      timestamptz NOT NULL DEFAULT now(),
  user_id int,
  role    text,
  action  text NOT NULL,
  detail  jsonb
);

CREATE TABLE clinical.patients (
  patient_id        serial PRIMARY KEY,
  clinic_id         int  NOT NULL,
  full_name         text NOT NULL,
  birth_date        date NOT NULL,
  birth_year        int  GENERATED ALWAYS AS (EXTRACT(YEAR FROM birth_date)::int) STORED,
  city              text,
  primary_condition text
);

CREATE TABLE serving.kpi_demo (
  metric text    NOT NULL,
  period date    NOT NULL,
  value  numeric NOT NULL,
  PRIMARY KEY (metric, period)
);
