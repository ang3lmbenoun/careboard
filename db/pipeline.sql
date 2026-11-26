-- Medicare Part D pipeline: the raw copy of the latest CMS download and the permanent record of every run.
-- Apply BEFORE db/risk.sql (data_checks reads app.pipeline_runs). Safe to run again. Applied by api/scripts/apply_pipeline.ts.
CREATE SCHEMA IF NOT EXISTS raw;

-- The latest download, as downloaded. One row per line of the CMS file. Replaced on every run, so storage stays small.
CREATE TABLE IF NOT EXISTS raw.medicare_part_d_spending (
  load_id   uuid NOT NULL,   -- ties the rows to one app.pipeline_runs row
  line_no   int  NOT NULL,   -- data line in the source file, first data row = 1
  brnd_name text,            -- the three text columns the transform reads
  gnrc_name text,
  mftr_name text,
  fields    jsonb NOT NULL,  -- every column exactly as downloaded, values as text
  PRIMARY KEY (load_id, line_no)
);
COMMENT ON TABLE raw.medicare_part_d_spending IS 'Latest CMS Medicare Part D Spending by Drug download, unchanged. Replaced on each pipeline run. No application role can read it.';

-- One row per pipeline run, written at the end, never updated or deleted.
CREATE TABLE IF NOT EXISTS app.pipeline_runs (
  id            bigserial PRIMARY KEY,
  load_id       uuid NOT NULL UNIQUE,
  pipeline      text NOT NULL,
  trigger       text NOT NULL CHECK (trigger IN ('manual', 'schedule')),
  target        text NOT NULL CHECK (target IN ('local', 'ci', 'neon')),
  status        text NOT NULL CHECK (status IN ('success', 'no_change', 'checked', 'failed')),
  started_at    timestamptz NOT NULL,
  finished_at   timestamptz NOT NULL DEFAULT now(),
  source_url    text,
  sha256        text,
  bytes         bigint,
  downloaded_at timestamptz,
  raw_rows      int,
  output_rows   int,
  years         int[],
  summary       jsonb,   -- spend and claims per year and class; the next run compares against it
  checks        jsonb,   -- every check: name, pass or fail, measured value, limit
  drift_reason  text,    -- set only when check 7 was overridden with --accept-drift
  error         text,
  git_sha       text
);
COMMENT ON TABLE app.pipeline_runs IS 'History of data pipeline runs: file hash, quality checks, result. Append only. Read only through app.data_checks().';

-- role_nurse is created later (nurse.sql) and gets no grants here, so it has none by default.
-- Nobody who serves the app can read, change or delete the history or the raw copy.
REVOKE ALL ON SCHEMA raw FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA raw FROM PUBLIC;
REVOKE ALL ON app.pipeline_runs FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'role_admin') THEN
    EXECUTE 'REVOKE ALL ON app.pipeline_runs FROM role_admin, role_clinician, role_executive';
    EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA raw FROM role_admin, role_clinician, role_executive';
  END IF;
END $$;

-- Append only, enforced in the database.
CREATE OR REPLACE FUNCTION app.pipeline_runs_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'app.pipeline_runs is append only'; END $$;
DROP TRIGGER IF EXISTS pipeline_runs_no_change ON app.pipeline_runs;
CREATE TRIGGER pipeline_runs_no_change BEFORE UPDATE OR DELETE ON app.pipeline_runs
  FOR EACH ROW EXECUTE FUNCTION app.pipeline_runs_append_only();
