-- Read-only role for Carry, the CareBoard assistant.
-- It can read two aggregate tables and nothing else: no patients, no users, no audit log.
-- Safe to run more than once. Run it after the serving tables exist (after load_serving.ts).

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'role_assistant') THEN
    CREATE ROLE role_assistant NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
END $$;

GRANT role_assistant TO careboard_api;

GRANT USAGE ON SCHEMA serving TO role_assistant;
REVOKE ALL ON ALL TABLES IN SCHEMA serving FROM role_assistant;
GRANT SELECT ON serving.medicaid_drug_quarterly, serving.clinic_daily TO role_assistant;
