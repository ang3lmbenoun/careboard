-- Policy knowledge base for the care agent (Part 2, stage 2): document chunks with embeddings and row-level security.
-- Safe to run more than once. Needs the pgvector extension (Neon supports it).
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS app.policy_chunks (
  id          serial PRIMARY KEY,
  doc_id      text   NOT NULL,
  chunk_no    int    NOT NULL,
  title       text   NOT NULL,
  content     text   NOT NULL,
  source      text   NOT NULL,
  visibility  text   NOT NULL CHECK (visibility IN ('public', 'clinic')),
  clinic_id   int,
  embedding   vector(384) NOT NULL,
  UNIQUE (doc_id, chunk_no),
  CHECK ((visibility = 'public' AND clinic_id IS NULL) OR (visibility = 'clinic' AND clinic_id IS NOT NULL))
);

-- Roles can only read. Ingestion runs with the admin login, never through the application.
REVOKE ALL ON app.policy_chunks FROM role_admin, role_clinician, role_executive;
GRANT SELECT ON app.policy_chunks TO role_admin, role_clinician, role_executive;
ALTER TABLE app.policy_chunks ENABLE ROW LEVEL SECURITY;

-- Filtering happens in the database, before similarity ranking: a chunk a session may not see is never ranked or returned.
-- Executives and admins have no clinic, so they see public chunks only (NULL never equals a clinic id).
DROP POLICY IF EXISTS chunks_visible ON app.policy_chunks;
CREATE POLICY chunks_visible ON app.policy_chunks FOR SELECT TO role_admin, role_clinician, role_executive
  USING (
    visibility = 'public'
    OR (visibility = 'clinic' AND clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::int)
  );

COMMENT ON TABLE app.policy_chunks IS 'Policy document chunks with 384-dimension embeddings. Row-level security limits each session to public chunks and its own clinic.';
