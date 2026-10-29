-- Group roles: what a signed-in user may do. They cannot log in.
CREATE ROLE role_admin     NOLOGIN;
CREATE ROLE role_clinician NOLOGIN;
CREATE ROLE role_executive NOLOGIN;

-- The one login the API uses. NOINHERIT: it holds no privileges of its own
-- beyond what is granted below; it can only switch into a group role per request.
-- A password is set later by the setup script.
CREATE ROLE careboard_api LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
GRANT role_admin, role_clinician, role_executive TO careboard_api;

CREATE SCHEMA serving;   -- aggregate marts, readable by every role
CREATE SCHEMA clinical;  -- synthetic patient-level data, restricted
CREATE SCHEMA app;       -- users and audit log

GRANT USAGE ON SCHEMA serving  TO role_admin, role_clinician, role_executive;
GRANT USAGE ON SCHEMA clinical TO role_clinician;
GRANT USAGE ON SCHEMA app      TO role_admin, role_clinician, role_executive, careboard_api;
