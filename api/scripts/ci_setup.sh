#!/usr/bin/env bash
# Builds a fresh CareBoard database for the test suite, the same way the README does for a local setup.
# Needs ADMIN_DATABASE_URL (a superuser on an empty database) and DATABASE_URL (the careboard_api login) in the environment.
# Run from the api folder. Used by the GitHub workflow; never point it at Neon.
set -euo pipefail
case "$ADMIN_DATABASE_URL" in *neon.tech*) echo "refusing to run against Neon"; exit 1;; esac
for f in ../db/init/*.sql; do psql "$ADMIN_DATABASE_URL" -v ON_ERROR_STOP=1 -q -f "$f"; done
psql "$ADMIN_DATABASE_URL" -v ON_ERROR_STOP=1 -q -c "ALTER ROLE careboard_api PASSWORD '${API_DB_PASSWORD}'"
npx tsx scripts/load_serving.ts
npx tsx scripts/apply_assistant.ts
npx tsx scripts/seed_patients.ts
npx tsx scripts/apply_risk.ts
npx tsx scripts/apply_agents.ts
npx tsx scripts/apply_nurse.ts
npx tsx src/seed.ts
npx tsx scripts/apply_policy.ts
npx tsx scripts/apply_digest.ts
npx tsx scripts/apply_mail.ts
npx tsx scripts/apply_handoff.ts
