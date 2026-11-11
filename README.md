# CareBoard

A role-aware health analytics app. One dataset, three kinds of users, and a database that decides what each of them may see.

**Live demo:** https://careboard-1755.onrender.com  
The first sign-in after a quiet period can take up to a minute while the free hosting wakes up. All patient-level data is synthetic.

![Overview](docs/screenshots/01-overview.png)

## What problem it answers

I built CareBoard as a mock company would brief it: a small health system with two clinics wants one place to answer business questions, without giving every employee access to everything.

| Role | Business questions the app answers | What the database refuses |
|---|---|---|
| **Executive** | Where is Medicaid drug spend concentrated? How much revenue do no-shows put at risk? What does the risk register say? | Any patient row. Small groups are hidden in the counts they do see. |
| **Clinician** | Which of my patients need attention first, and why? Who is on which drug class? | Other clinics' patients, and every patient's name and birth date. |
| **Admin** | Are the controls still working? What happened in the audit log? Is the data healthy? | Patient rows and password hashes. |

## What is in it

- **Overview, Medicaid, Operations, Drug classes.** Public Medicaid drug spend (2024) and synthetic clinic appointments, with drill-downs.
- **Care risk.** A points-based risk score per synthetic patient with the reasons shown. Clinicians get a worklist for their clinic; executives and admins get counts with small cells hidden by the database.
- **Operational risk.** Revenue at risk from no-shows, with adjustable visit value and target rate.
- **Financial exposure.** Spend concentration index, price versus volume, and a what-if slider. Scenarios, not forecasts.
- **Risk & compliance.** A 16-item risk register, a 15-item control map tied to HIPAA Security Rule areas, live security metrics, data-health checks, and 8 control tests that query the database each time the page loads.
- **Patients.** Synthetic patients with avatars, A1C and weight charts, and medication history. Clinicians can add and remove demo patients under hard limits.
- **Data catalog.** What each number means, where it comes from, a sensitivity label on every column, and which columns your role cannot read.
- **Audit log.** Sign-ins, failed sign-ins, denied requests, data views, and every question asked of the assistant.
- **Carry.** A natural-language assistant that answers questions about the aggregate data and can read nothing else.

| | |
|---|---|
| ![Risk and compliance](docs/screenshots/02-risk-compliance.png) | ![Care risk worklist](docs/screenshots/03-care-risk.png) |
| ![Data catalog with a locked column](docs/screenshots/04-catalog-locked.png) | ![Carry answering a question](docs/screenshots/05-carry.png) |

## Architecture

```
Browser (React 19 + Vite + Recharts)
   │  HTTPS, JWT (8 hours)
   ▼
Express 5 API ──────────────► Groq (Carry only: question text and aggregate results)
   │  per request:
   │  BEGIN; SET LOCAL ROLE role_<admin|clinician|executive>; set clinic id
   ▼
PostgreSQL 17 (Neon in production, Docker locally)
   ├─ serving.*   aggregate tables, readable by every role
   ├─ clinical.*  synthetic patients, medications, readings; row-level security
   ├─ app.*       users, audit log, risk register, control map, classification
   └─ roles       role_admin, role_clinician, role_executive, role_assistant (all NOLOGIN)
                  careboard_api (the only login; holds no privileges of its own)
```

The key design choice: **the API does not decide who sees what. The database does.** The API login cannot read anything. For each request it switches into the signed-in user's role, and Postgres applies that role's grants and row-level security. A bug in the API can't hand out more than the role allows.

### Data

| Dataset | Source | Notes |
|---|---|---|
| `serving.medicaid_drug_quarterly` | CMS State Drug Utilization Data, 2024, prepared by my separate diabetes-glp1-pipeline project | Four classes: GLP-1, insulin, DPP-4, metformin. SGLT2 inhibitors are not included. Small cells may be hidden in the source, so totals can understate. Spend is the amount reimbursed; as far as I know it is before manufacturer rebates. |
| `serving.clinic_daily` | **Synthetic**, fixed random seed | Daily scheduled, completed and no-show counts for 2 clinics and 3 departments, weekdays, Jan 2024 to Oct 2026. |
| `clinical.*` | **Synthetic** | 48 seeded patients (24 per clinic) plus demo-added ones. The seed shapes some patients as poorly controlled or lost to follow-up so the risk rules have something to find. These are not findings about real people. |

## How data is protected

| Control | How it works |
|---|---|
| Roles in the database | Three group roles hold the privileges. The API login has none and switches role per request. |
| Row-level security | Clinicians see only patients of their own clinic. With no clinic set, they see nothing. |
| Column grants | `full_name` and `birth_date` are readable by no role at all. |
| Audit trail | Every sign-in, failed sign-in, denied request, data view, patient add/remove and Carry question is logged. App roles can insert but never update or delete. Only admin can read. Failed sign-ins do not store what was typed. |
| Minimum cell size | Patient counts shown to executives and admins hide any group under 5, and hide a second number when needed so it can't be worked out by subtraction. Enforced inside a database function. |
| Throttles | Sign-in 30 attempts per 15 minutes per IP. Carry 20 requests per 10 minutes per IP, plus a daily cap. Adding demo patients 12 per hour, removing 40 per hour. |
| Demo write guards | A database trigger and row-level policies allow clinicians to add or remove only demo patients, in their own clinic, up to 30 per clinic. No free text is accepted. Demo patients expire after 6 hours. |
| Control tests | 8 live checks, for example "no role can read names or birth dates" and "the assistant role cannot reach patient, user or audit data". If a permission changes, a test turns red. |

### Carry, the assistant

Carry turns a question into one SQL `SELECT`, runs it, and explains the result. The model never gets database access. The query runs as `role_assistant`, which is read-only, can read two summary tables, runs inside a `READ ONLY` transaction with a 5-second timeout and a 200-row cap, and passes a SQL checker first. It has no access to the `clinical` or `app` schemas. The model is set with `GROQ_MODEL` (currently `openai/gpt-oss-20b` on Groq), and a daily question cap is set with `ASSISTANT_DAILY_LIMIT`. Questions are recorded in the audit log.

### What this is not

- It is **not HIPAA compliance**. All patient data is invented. The risk register and the HIPAA references are my own work as a learning exercise, and the references should be checked against the regulation text before anyone relies on them.
- Risk scores are my judgment on a 5×5 scale. Care-risk rules are illustrative and not clinical guidance.
- Known gaps, listed in the app on purpose: no multi-factor sign-in, no per-account lockout, tokens can't be revoked early, no idle timeout, and the database owner can still edit the audit log. Demo accounts share a published password by design.

## Tech stack

React 19, Vite, TypeScript, Recharts · Node, Express 5, `pg`, `helmet`, `express-rate-limit`, `bcryptjs`, `jsonwebtoken` · PostgreSQL 17 · Docker Compose (local) · Neon and Render free tiers (production) · Groq (assistant).

## Demo accounts

| Role | Email |
|---|---|
| Admin | `admin@careboard.dev` |
| Clinician (clinic 1) | `clinician@careboard.dev` |
| Executive | `executive@careboard.dev` |
| Nurse, data entry (clinic 1) | `nurse@careboard.dev` |

Password for all four: `REPLACE_WITH_DEMO_PASSWORD` (demo only, protects synthetic data).

Things to try: sign in as the clinician and open **Care risk**; as the executive, open **Care risk** and notice the hidden cells; as the admin, open **Risk & compliance** and scroll to the control tests; ask Carry for patient names and watch it refuse, then find the question in the admin's **Audit log**.

## Run it locally

Prerequisites: Node 22 or newer, Docker Desktop. I have not run this from a clean clone on a second machine, so treat the steps as a checklist and tell me if one breaks.

1. Create `.env` in the repo root with `POSTGRES_PASSWORD=<choose one>`, then start the database: `docker compose up -d`. The scripts in `db/init` create the schemas, roles and tables on first start.
2. Create `api/.env` with the variables below.
3. Give the API login a password, matching `DATABASE_URL`: `docker exec -it careboard-db psql -U careboard_admin -d careboard -c "ALTER ROLE careboard_api PASSWORD '<choose one>'"`.
4. In `api`, run `npm install`, then in this order:
   ```
   npx tsx scripts/load_serving.ts       # Medicaid and clinic data from /data, plus column comments
   npx tsx scripts/apply_assistant.ts    # the read-only role for Carry
   npx tsx scripts/seed_patients.ts      # synthetic patients, medications, readings
   npx tsx scripts/apply_nurse.ts        # the nurse data-entry role
   npx tsx src/seed.ts                   # the four demo accounts
   npx tsx scripts/apply_risk.ts         # risk register, control map, care risk view, checks
   npm start                             # API on port 4100
   ```
5. In `web`, run `npm install` and `npm run dev`, then open the address Vite prints.

`api/.env` variables (never commit this file; it is in `.gitignore`):

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Connection for the API login (`careboard_api`) |
| `ADMIN_DATABASE_URL` | Admin connection used only by setup scripts |
| `JWT_SECRET` | Signs sign-in tokens |
| `DEMO_PASSWORD` | Password given to the four demo accounts by `src/seed.ts` |
| `GROQ_API_KEY`, `GROQ_MODEL`, `ASSISTANT_DAILY_LIMIT` | Carry |
| `NEON_ADMIN_URL`, `NEON_API_PASSWORD` | Only for `--neon` scripts |

## Deploy

Production runs on a Render web service (free) and a Neon Postgres database (free). The API serves the built web app, so one service does both: build `web` with `npm run build`, then start `api` with `npm start`. Set the same variables in Render's environment settings.

**Order matters.** Apply database scripts to Neon (`--neon`) **before** pushing server code that depends on them, because Render redeploys on every push. Setup scripts for Neon: `bootstrap_neon.ts` once, then `load_serving.ts`, `apply_assistant.ts`, `seed_patients.ts`, `apply_nurse.ts` and `apply_risk.ts`, each with `--neon`.

## Repository map

```
api/src        server.ts (routes), risk.ts (risk routes), assistant.ts (Carry), sqlGuard.ts, db.ts, patientGen.ts
api/scripts    setup, loading and check scripts
db/init        schemas, roles, tables, grants
db/*.sql       patients.sql, assistant.sql, risk.sql, comments.sql (idempotent; run by the scripts)
data           Medicaid and clinic CSVs loaded into the serving schema
web/src        pages (Overview, Medicaid, Operations, CareRisk, OpsRisk, SpendRisk, RiskCompliance, ...)
```

The plain-language dataset descriptions in the data catalog live in `web/src/catalogContent.ts` and are hand-written, so they can drift from the schema. Column descriptions come from database comments in `db/comments.sql` and cannot.

## What I would do next

Add automated tests that sign in as each role and compare row sets, schedule the data-health checks with alerts, add multi-factor sign-in and per-account lockout, and ship the audit log to storage the database owner can't edit.

## Data sources and credits

Medicaid data: Centers for Medicare & Medicaid Services, State Drug Utilization Data. Medicare data: Centers for Medicare & Medicaid Services, Medicare Part D Spending by Drug (2020 to 2024). CMS publishes both datasets as public data.

Everything else, including every patient, coverage record, appointment and risk score, is synthetic and generated by the scripts in this repository.

## License

The code in this repository is released under the [MIT License](LICENSE). You may use, copy, modify and distribute it, including in commercial work, as long as you keep the copyright notice. It comes with no warranty. CareBoard uses synthetic patients and is a portfolio project, not a certified healthcare or HIPAA compliant product, so do not use it with real patient data without your own security and compliance review.
