-- Email digest (Part 2 stage 4). Safe to run more than once. Run after db/agents.sql.
-- A digest is sent only to addresses on the allow list, contains aggregates only, and every attempt is logged.
-- Only the admin role can touch these tables, and the log cannot be edited or deleted.

CREATE TABLE IF NOT EXISTS app.digest_recipients (
  email      text PRIMARY KEY CHECK (email = lower(email) AND email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' AND length(email) <= 200),
  label      text NOT NULL DEFAULT 'executive',
  enabled    boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app.digest_log (
  id             bigserial PRIMARY KEY,
  at             timestamptz NOT NULL DEFAULT now(),
  digest_date    date NOT NULL DEFAULT current_date,
  kind           text NOT NULL DEFAULT 'executive' CHECK (kind IN ('executive')),
  recipient      text NOT NULL,
  status         text NOT NULL CHECK (status IN ('sent', 'dry_run', 'blocked', 'error')),
  reason         text,
  narrative      text CHECK (narrative IN ('model', 'template', 'rejected')),
  content_sha256 text,
  body_chars     int
);
-- One real send per recipient per day, enforced by the database.
CREATE UNIQUE INDEX IF NOT EXISTS digest_one_send_per_day ON app.digest_log (recipient, kind, digest_date) WHERE status = 'sent';

REVOKE ALL ON app.digest_recipients, app.digest_log FROM role_clinician, role_executive, role_admin;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'role_nurse') THEN
    EXECUTE 'REVOKE ALL ON app.digest_recipients, app.digest_log FROM role_nurse';
  END IF;
END $$;
GRANT SELECT, INSERT ON app.digest_recipients, app.digest_log TO role_admin;
GRANT UPDATE (enabled) ON app.digest_recipients TO role_admin;
GRANT USAGE ON SEQUENCE app.digest_log_id_seq TO role_admin;

COMMENT ON TABLE app.digest_recipients IS 'Allow list for digest emails. Nothing is sent to an address that is not here and enabled.';
COMMENT ON TABLE app.digest_log IS 'Every digest attempt: sent, dry run, blocked or error. Holds a hash of the content, never the content.';
