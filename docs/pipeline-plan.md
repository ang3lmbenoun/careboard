# Plan: a repeatable, checkable Medicare data pipeline (step E)

Status: **plan only**. Nothing in this file has been built. Written 2026-11-15 from the repository files. I did not run any script, connect to a database or download anything; where I cite a number from the committed CSV files I counted it from the file.

How to read this plan:
- File and line references point at the code that backs a claim, like `api/scripts/export_medicare.ts:45`.
- "not verified" means the repo does not show it. I did not guess.
- Hour estimates are my own rough numbers for focused work, not measured.
- Decisions that need your yes are marked **D1** to **D5** and collected in one table below.

## What exists today (the starting point)

- `export_medicare.ts` downloads one fixed CMS file when you run it (`:10-11`, `:40-41`), keeps only the "Overall" row per drug (`:44-45`), groups drugs into four classes with hard-coded brand lists (`:14-35`), sums by year, class and drug (`:52-70`), and writes `data/medicare_part_d_annual.csv` (`:79-81`). It keeps no copy of the download. Its checks are printed, not enforced (`:83-95`).
- `load_serving.ts` replaces the table from that CSV with `TRUNCATE` and `INSERT` in one transaction, together with the other two serving tables (`:51,65-66,72`). Primary key (year, drug_class, drug) (`:25-28`).
- `test_medicare.ts` already tests the class rules and the committed CSV: no duplicate keys, four classes, five years, positive values (`:25-37`). It imports `classify` from `export_medicare.ts` (`:5`), so that export must stay.
- `app.data_checks()` has two Medicare checks: no missing or negative amounts, and "five years, four classes" (`db/risk.sql:340-347`). Nothing records when the data was loaded or which file it came from (`docs/data-lineage.md`, section 3, gap 5).
- The committed file has 81 rows: 2020 to 2024, 15, 15, 16, 17 and 18 rows per year, 18 distinct drugs (counted by me from `data/medicare_part_d_annual.csv`).

## Decisions I need from you

| # | Decision | My recommendation |
|---|---|---|
| D1 | Where the raw download is kept (section 1) | A gitignored folder plus a workflow artifact now; commit it only if the first download is small. |
| D2 | Tolerance for "totals vs previous load" (section 3) | 2 percent per year and class, as a placeholder until I can compare two real downloads. |
| D3 | How to deal with clinic data going stale (section 6) | Option B: regenerate through the last open day, and rerun when needed. |
| D4 | What the GitHub job may do on Neon (section 5) | Check-only with a limited database login. Applying stays a manual command from your laptop. |
| D5 | Schedule (section 5) | Monthly check, plus run-on-demand. |

Neon rule from `CLAUDE.md`: I will not touch Neon until you say yes. The first Neon step is in task 9.

---

## 1. Download with a saved raw copy, date and SHA-256

**What the run does first**
1. Fetch the URL (default: the one in `export_medicare.ts:10-11`; a `--url=` option or a workflow input replaces it).
2. Stop with an error if the HTTP status is not 200, the body is empty, or the first line is not a CSV header that contains the columns the transform needs. Those columns are `Mftr_Name`, `Brnd_Name`, `Gnrc_Name` and at least one `Tot_Spndng_YYYY` and `Tot_Clms_YYYY` (`export_medicare.ts:45-67`). A web error page therefore cannot be loaded as data.
3. Compute SHA-256 over the exact bytes received, and note the UTC time the download finished.
4. Save the bytes unchanged, plus a small manifest next to them.

**Where, and in what format**

| What | Where | Format |
|---|---|---|
| The download | `data/raw/medicare_part_d/<UTC date>_<source file name>_<first 12 hex of the hash>.csv` | The original bytes, untouched. The current parser accepts a byte-order mark (`export_medicare.ts:42`), so I do not rewrite the file. |
| The manifest | Same name, ending `.json` | `source_url`, `downloaded_at_utc`, `sha256`, `bytes`, `http_status`, any `ETag` and `Last-Modified` headers CMS sends (not verified that it sends them), the git commit of the script, and the trigger (manual or scheduled). |
| The record that survives | One row in `app.pipeline_runs` (section 2) | Same facts as the manifest, plus the check results. This is the permanent record. |
| In GitHub Actions | A workflow artifact with an explicit retention (I suggest 90 days) | The same two files. |

**D1.** `data/raw/` would be listed in `.gitignore`, so the repo does not grow. The file size is **not verified**: the repo holds only the summed output. Task 1 downloads it once to measure. If it is small, a few megabytes, committing each release is reasonable and gives a permanent copy. If it is large, keep only the hash in the database and the artifact for a limited time.

**Same hash as the last successful load.** The run records "no change", does not touch the serving table, and still counts as a successful check for freshness (section 4).

## 2. Raw table and transform

### Raw schema

Two new objects, created by a new migration `db/pipeline.sql`, applied by a new `api/scripts/apply_pipeline.ts` (idempotent, ending with PASS/FAIL checks, as the other `apply_*.ts` scripts do):

```sql
CREATE SCHEMA IF NOT EXISTS raw;

-- The latest download, as downloaded. One row per line of the CMS file.
CREATE TABLE IF NOT EXISTS raw.medicare_part_d_spending (
  load_id   uuid NOT NULL,   -- ties the rows to one app.pipeline_runs row
  line_no   int  NOT NULL,   -- line in the source file, header = 1
  brnd_name text,            -- the three text columns the transform reads
  gnrc_name text,
  mftr_name text,
  fields    jsonb NOT NULL,  -- every column exactly as downloaded, values as text
  PRIMARY KEY (load_id, line_no)
);

-- One row per pipeline run, written at the end, never updated or deleted.
CREATE TABLE IF NOT EXISTS app.pipeline_runs (
  id            bigserial PRIMARY KEY,
  load_id       uuid NOT NULL UNIQUE,
  pipeline      text NOT NULL,                 -- 'medicare_part_d'
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
  summary       jsonb,                         -- spend and claims per year and class, used by the next run's comparison
  checks        jsonb,                         -- every check: name, pass or fail, measured value, limit
  error         text,
  git_sha       text
);
```

**Why `fields jsonb` and not one column per CMS column.** The spend columns carry the year in their names (`Tot_Spndng_2024`; years are read from the column names at `export_medicare.ts:46-50`), so a release for a new year has different column names. A fixed-column table would need a migration every year. The three name columns are real columns because the transform and the "Overall" filter read them (`:45,55`).

**Which rows are kept.** The raw table holds only the latest download. The next run replaces it, so storage stays small. Everything that must live on is in `app.pipeline_runs.summary` and `.checks`, which are small. Raw rows of a run whose checks failed are kept on purpose, so the failure can be inspected, and the serving table is untouched.

**Access.** The `raw` schema gets no `USAGE` for any application role. `app.pipeline_runs` is revoked from all application roles and read only inside the `SECURITY DEFINER` function `app.data_checks()` (section 4). That keeps the rule from `CLAUDE.md`: the database, not the application, decides who sees what. `test_rls_posture.ts` and the control tests need new assertions for the two tables. Both tables also get a row in `app.data_classification` (`db/risk.sql:147-176`).

### Transform

- A pure function `transformMedicare(rows) → { rows, summary }`, taken out of `export_medicare.ts:44-77`. It keeps, line for line: the **"Overall" filter** (`Mftr_Name === "Overall"`, `:45`), year detection (`:46-50`), `classify()` (`:20-35`), the sums (`:52-70`) and the drop of all-zero rows (`:72-75`).
- The output has the same columns and the same **primary key (year, drug_class, drug)** as `serving.medicare_part_d_annual` (`load_serving.ts:25-28`). No change to that table's definition.
- `classify()` stays exported from `export_medicare.ts`, and `export_medicare.ts` stays as a thin command that calls the new code, so `test_medicare.ts` and the README steps keep working.
- Applying means: in one transaction, `TRUNCATE serving.medicare_part_d_annual`, insert the output, commit, then insert the `app.pipeline_runs` row. Only this one table is touched, not Medicaid or clinic data.
- The run also writes the candidate `data/medicare_part_d_annual.csv`, so git and CI stay consistent with Neon. **Caution:** `load_serving.ts` reloads Medicare from the committed CSV. If the pipeline updates Neon and you do not commit the new CSV, the next `load_serving.ts --neon` quietly puts the old data back. The pipeline should print that warning.

## 3. Quality checks that fail the run

All checks run every time (not stopping at the first), every result is saved in `app.pipeline_runs.checks`, and any failure means: exit code 1, status `failed`, serving table untouched, raw rows kept.

| # | Check | Rule | Basis |
|---|---|---|---|
| 1 | Source row count | All rows and "Overall" rows each within **10 percent** of the previous successful load; above zero. | The source count is not recorded anywhere today. The first run only records a baseline and cannot fail this check. I will not invent a range before I have the number. |
| 2 | Output row count | Between 0.9 and 1.25 times the previous load. With today's 81 rows that is 73 to 101. | Rows per year are 15 to 18 now. A rolling window or one new brand stays inside that. |
| 3 | Five years present | Exactly 5 distinct years, consecutive. | Same rule as `db/risk.sql:344-347` and `test_medicare.ts:36`. |
| 4 | Four classes present | Exactly GLP-1, Insulin, DPP-4, Metformin, and each class has spend above zero in every year. | `db/risk.sql:346`, `test_medicare.ts:35`. Metformin is the smallest class (0.41 to 0.63 billion dollars a year in the committed file), still well above zero. |
| 5 | No negative or missing values | Spend and claims not null and not negative in every output row. Output rows must be above zero, because the transform drops all-zero rows. | `db/risk.sql:340`, `test_medicare.ts:37`, `export_medicare.ts:73`. |
| 6 | Unique keys | No repeated (year, drug_class, drug). | Primary key; `test_medicare.ts:33-34`. |
| 7 | Totals vs the previous load | For every (year, class) that is in both the previous accepted load and this one, the spend total differs by at most the tolerance (**D2**, proposed **2 percent**). Years in the previous load but missing now may only be the oldest ones (a rolling window). | Past years should barely change. Whether CMS restates earlier years is **not verified**. 2 percent is a placeholder to be set from a real comparison (task 1). |

**Recorded, not failing: the newest year against the year before.** The committed file shows why this cannot be a hard rule: Insulin fell from 15.60 to 7.31 billion dollars from 2023 to 2024 (minus 53.1 percent), and GLP-1 rose from 21.91 to 27.23 (plus 24.3 percent). A "within 50 percent" rule would reject the data already in the app. These changes are stored in `summary` and shown beside the freshness check so a person can judge them.

**Overriding.** CMS may restate figures legitimately. I propose an explicit `--accept-drift="reason"` option for check 7 only. It records the reason in `app.pipeline_runs` and never skips checks 2 to 6. Optional; see task 8.

## 4. Freshness in `app.data_checks()`

**Where it shows today**
- The admin Risk and compliance page lists every check with pass, warn or fail (`api/src/risk.ts:51,88-91`, `web/src/RiskCompliance.tsx:39`).
- The Overview tile turns to "warn" unless **every** check passes (`web/src/Overview.tsx:270,291`).
- **The executive digest lists every check that is not "pass" as failing** (`api/src/digest.ts:55,69,90`). So a warning is emailed on weekdays. New checks must not create a standing warning by design.

**New checks** (area "Medicare pipeline"), added to the one definition of the function in `db/risk.sql:310-366`, not as a second copy:

| Check | pass | warn | fail |
|---|---|---|---|
| Last pipeline run | A `success`, `no_change` or `checked` run in the last **45 days**. | The latest of those is **46 to 90 days** old. | The latest run has status `failed`. |
| Newest data year | Newest year is at least this year minus 3. | Older than that. | Never. |
| Loaded file still current | The latest run's hash equals the hash of the loaded file. | They differ, meaning CMS changed the file since the last load (a monthly check run notices this). | Never. |

**Why these numbers.**
- 45 days: a monthly schedule (section 5) plus slack. A run that finds no change still counts, because the point is that someone checked.
- Minus 3 years: the current file is data year 2024, released in June 2026 (the file name carries `DY24` and a `2026-06` path, `export_medicare.ts:11`). That is a lag of about two years. A rule of minus 2 would warn on 1 January 2027, before CMS can have published 2025. Minus 3 first warns on 1 January 2028 if 2025 has not been loaded. How often CMS publishes: **not verified**.
- **Before the first run** there is no row. The check then returns **pass** with the detail "pipeline not used yet (data loaded from CSV)", so deploying it does not create a warning. It starts enforcing after the first recorded run.

**Implementation notes**
- `app.data_checks()` is `SECURITY DEFINER` with `search_path = pg_catalog, pg_temp` (`db/risk.sql:312`), so every table in the new queries must be written with its schema.
- `db/pipeline.sql` must be applied **before** `db/risk.sql`, in `ci_setup.sh` and in the Neon setup order in the README (`README.md`, line with "Setup scripts for Neon"). Neon order: apply the migration to Neon first, push code second (`CLAUDE.md`, "Deploy rules").
- `app.data_inventory()` (`db/risk.sql:297-308`) could gain a row for the last pipeline run. Optional.
- Tests: a database test that inserts fake `app.pipeline_runs` rows in a transaction that is rolled back (the pattern in `test_handoff.ts`) and asserts pass, warn and fail at 44, 46 and 91 days, and a failed run. The digest test must cover that a warning appears under "Failing".

## 5. Scheduling

**Manual command (always available)**

`npx tsx scripts/pipeline_medicare.ts [--url=...] [--apply] [--neon] [--accept-drift="reason"]`

- Default is **check**: download, hash, save, load the raw table, run the checks, record the run, write the candidate CSV. It never touches the serving table.
- `--apply`: after all checks pass, swap the serving table and record `success`.
- `--neon` is required for Neon, so nothing reaches Neon by accident. The script refuses `--apply --neon` unless it is run interactively with a confirmation prompt.

**GitHub Actions workflow `medicare-refresh.yml`**

- Triggers: `workflow_dispatch` with the inputs `source_url` (optional) and `apply` (default false), and a monthly `schedule`, for example `23 13 1 * *` (UTC). Same shape as `digest.yml:4-7`.
- The scheduled run is **check-only**. It never applies. **D4:** applying stays a manual command from your laptop, after you read the artifact. That keeps the Neon login stored in GitHub from being able to change app data.
- Needs:
  - `NEON_ADMIN_URL` is already a repository secret (`digest.yml:18`). It is an owner connection string, so using it gives the job full database power. I recommend a separate login `careboard_pipeline` with only INSERT and TRUNCATE on `raw.*`, INSERT and SELECT on `app.pipeline_runs`, and a new secret `NEON_PIPELINE_URL`. Creating that login on Neon needs your yes.
  - No CMS secret: the fetch sends no credentials (`export_medicare.ts:40`).
  - Like `digest.yml:24-32`, the job does nothing and says so if the secret is missing.
- Same hygiene as the digest workflow: `concurrency` group, `timeout-minutes`, `permissions: contents: read` (`digest.yml:8-16`).
- Uploads the raw file, manifest and candidate CSV as artifacts.
- A test run of the whole pipeline in CI against a throwaway Postgres (as `tests.yml:12-19` does) needs no Neon access. The baseline there is the committed CSV loaded by `ci_setup.sh`.

**What could break**
- CMS moves or removes the file. The URL has a date folder and an id in it (`export_medicare.ts:10-11`), so a new release will have a new URL. Nothing in the repo finds new URLs (**not verified** whether a catalog exists). The URL stays an input; a human supplies it. The monthly run re-downloads the **same** URL, so what it can detect is a silent change to that file, not a new release.
- CMS renames columns. The header check in section 1 fails the run before any data is touched.
- The release drops 2020 (rolling window) or adds a sixth year. Check 3 fails on a sixth year, and check 7 allows only the oldest year to disappear. Which one CMS does is **not verified**.
- GitHub may block or throttle the CMS download from its runners (**not verified**).
- GitHub runs scheduled jobs on a best-effort basis (`keepalive.yml:3`), and, by GitHub's documented behaviour (not checked here), turns off scheduled workflows in a public repository after 60 days without repository activity. A silent stop is exactly what the "last pipeline run" check is for.
- Neon free tier: cold start, connection limits and the storage limit (**not verified**; the raw table is replaced, not appended, to stay small).

**Out of scope here:** Medicaid (it lives in the other project); finding new CMS URLs; opening a pull request with the new CSV; alerts beyond the admin page and the digest; keeping old raw loads.

## 6. Extending the synthetic clinic data

### What the check does, and when it warns

`Data is recent` warns when `current_date - max(day) > 60` (`db/risk.sql:320-323`). The data ends on 2026-10-28 (`api/scripts/generate_clinic_ops.ts:25`). On 2026-12-28 the gap is 61 days, so it warns that day. In the live app that turns the Overview data-checks tile to "warn" and puts "Data is recent" in the executive digest as failing (section 4).

For an end date E, the first warning day is E plus 61 days. Weekends have no rows (`generate_clinic_ops.ts:26,37`), so E is the last weekday that has rows.

### Existing rows do not change

The generator draws random numbers in date order, two per clinic, department and open day (`generate_clinic_ops.ts:15,33-61`). Moving only the end date adds draws after the existing ones, so the first 4,386 rows should come out identical. This is my reading of the code, not a test. A test must prove it: regenerate with the old end date and compare with the committed file.

### The problem with simply extending

Any end date after today puts **future days** in the data, with completed and no-show counts for appointments that have not happened. The app also shows the end date as "Data to {as_of}" (`web/src/OpsRisk.tsx:78`, `api/src/risk.ts:138`), which would be a future date. That is visible in a demo.

### Options (**D3**)

| | What | Good | Bad |
|---|---|---|---|
| **A** | Fixed later end date, for example 2027-03-31. | One edit. | Future rows. The "as of" date is in the future until that day. Warns again 61 days after the end date. |
| **B** (recommended) | Add `--through=YYYY-MM-DD` (default: yesterday) and regenerate through the last open day, then reload. | No future rows. The check keeps its meaning: "someone regenerated recently". | Needs a rerun at least every 60 days. A run on 2026-11-15 ends on Friday 2026-11-13 and warns from 2027-01-13. |
| **C** | Change the check so a synthetic table reports its fixed end date instead of warning. | No upkeep. | The check can never fail for that table, which is what the repo's own principle warns against. The current check text already says "a warning appears as time passes" (`db/risk.sql:323`). |

B can be moved onto the workflow in section 5 later, as a scheduled regeneration, but only with the same care about Neon.

The care-risk score uses its own fixed "today", 2026-10-28 (`db/risk.sql:186-188`, `api/scripts/seed_patients.ts:32`). Extending the clinic data does not change it and no check depends on it, but the two datasets would then disagree about "now". Decide that separately.

### Numbers and text that change if the end date moves

| Where | What changes |
|---|---|
| `README.md:84` | "Jan 2024 to Oct 2026" becomes the new end month. |
| `docs/data-lineage.md` line 22 | Row count (4,386) and last day (2026-10-28) for `serving.clinic_daily`. |
| `docs/data-lineage.md` line 164 | The date the check starts warning (2026-12-28). |
| `docs/data-lineage.md` lines 29, 34, 93, 165 | These are the patient and care-risk date. They change only if you also move that date. |
| `data/clinic_daily.csv` | Longer file; first lines unchanged (to be tested). |
| `bi/data/fact_clinic_daily.csv`, `dim_date.csv`, `_manifest.csv` | Stale until `export_bi.ts` is run again. Whether `bi/data/careboard_tableau.twb` embeds data: **not verified**. |
| Live screens | Nothing is typed into the docs, but every "last 12 months", "vs year before", "last 90 days", weekday and month figure moves, because those windows are measured back from the newest day (`api/src/risk.ts:139-171`). The digest's clinic totals cover all rows (`api/src/digest.ts:47-51`) and move too. |
| Eval case G2 | Expects the answer to name "clinic 2" (`api/eval/cases.ts:59`). That depends on which clinic has the higher no-show rate in the data. In the generator both clinics share the same base rates per department and differ by noise and department mix (`generate_clinic_ops.ts:18-22,48-50`), so the margin is small. **G2 must be run again** after any change. |
| `docs/eval-report.md` | Generated. My search found no percent or dollar figures in it, so nothing to fix by hand; it regenerates on the next full run. |
| Tests | `test_agent.ts` uses made-up numbers in stubs (`:114-119`) and does not depend on the data. I found no test that depends on clinic row counts. |

## 7. Class-definition comparison

### The Medicare rules today (`api/scripts/export_medicare.ts:14-35`)

Brand names are trimmed and lower-cased, and a brand matches when it **starts with** a listed word (`:23`). The order of rules matters.

| Order | Class | Rule |
|---|---|---|
| 1 | GLP-1 | Brand starts with: ozempic, wegovy, rybelsus, mounjaro, zepbound, trulicity, victoza |
| 2 | DPP-4 | Brand starts with: januvia, janumet, onglyza, tradjenta |
| 3 | Metformin | Generic name is exactly `metformin hcl` |
| 4 | Insulin | Generic name contains `insulin` and does not match `lixisenatide|liraglutide|supplies|pump|needle`. The drug is labelled with the brand if it starts with humalog, lantus, levemir, novolog or tresiba, otherwise `Insulin (other)`. |
| – | Not included | Everything else. SGLT2 inhibitors are excluded on purpose; `test_medicare.ts:17-23` lists Jardiance, Synjardy, Soliqua, syringes, insulin pumps and Byetta as left out. |

### What the committed data shows

The Medicaid and Medicare files use the **same 18 class and drug labels**, including `Insulin (other)` (counted by me from `data/medicaid_drug_quarterly.csv` and `data/medicare_part_d_annual.csv`). So the output labels line up. That says nothing about whether the rules that produce them are the same.

### What must be checked against the Medicaid rules (you will supply them)

1. **Matching mode.** Medicare matches the start of the brand name. If the Medicaid rule matches anywhere in a product name, products like "Victoza 2-Pak" or labels with a prefix could land in different classes. Which Medicaid field is matched (product name, brand, generic): **not verified**.
2. **Brand lists, one by one.** Every brand above against the Medicaid list, in both directions. Differences go into a table: brand, class in Medicare, class in Medicaid, which is right.
3. **Metformin and combination drugs.** Medicare takes only the exact generic `metformin hcl`, and tries GLP-1 and DPP-4 brands first, so Janumet counts as DPP-4 and Synjardy is left out. A Medicaid rule that matches "metformin" anywhere would count combinations as Metformin. Check which class wins in each system.
4. **Insulin.** The exclusion words (supplies, pump, needle, lixisenatide, liraglutide) against the Medicaid exclusions. Check combination products (Soliqua, Xultophy) and inhaled or other insulins.
5. **Gaps present on both sides.** Medicare leaves out Byetta and Bydureon (exenatide), Saxenda (liraglutide) and Adlyxin, and does not list Nesina, Kazano, Oseni, Jentadueto or Kombiglyze for DPP-4. Does Medicaid include any of them?
6. **Same exclusion of SGLT2.** Both table comments say SGLT2 is excluded (`db/comments.sql:1,31`). Confirm the Medicaid rules exclude combinations that contain one.
7. **Method.** Build one list of every brand and generic name from the Medicare raw table and every product name from the Medicaid source, run each through both rule sets, and list every name that one system classifies and the other does not or classifies differently. That list is the result.

Longer term, the rules should live in one table that both programs read. The Medicaid side is in the other project, so that is out of scope here.

## 8. Facts I could not verify

- The size and row count of the CMS file, and its full column list. I know only the columns the script reads.
- Whether CMS restates earlier years, how often it publishes, and whether the file is a rolling five-year window.
- Whether CMS sends `ETag` or `Last-Modified`, and whether GitHub runners can download from data.cms.gov.
- Whether a CMS catalog exists to find new release URLs.
- The Neon free-tier storage and connection limits.
- Whether the Tableau workbook embeds data.
- The Medicaid keyword rules and the field they match (you will supply them).
- GitHub's scheduled-workflow shut-off after 60 days without activity, which I am relying on from memory.

## 9. Task list and estimates

My estimates, in hours of focused work, not measured. Tasks 2 to 7 can be built and tested with no Neon access.

| # | Task | Estimate | Needs from you |
|---|---|---|---|
| 1 | Download the file once with a throwaway script. Record size, row count, columns, and compare the 2020 to 2024 totals with the committed CSV. Set the placeholders in checks 1, 2 and 7 from the real numbers. | 0.5 to 1 h | Internet; your go |
| 2 | Split `export_medicare.ts` into fetch, parse and `transformMedicare`; keep `classify` and the command. Unit tests with a small fixture file that includes manufacturer rows (proves the "Overall" filter) and a duplicate-key case. | 2 to 3 h | |
| 3 | `db/pipeline.sql`, `apply_pipeline.ts` with PASS/FAIL checks, `ci_setup.sh`, README Neon order, `app.data_classification` rows, new assertions in `test_rls_posture.ts`. | 2 to 3 h | |
| 4 | `pipeline_medicare.ts`: download, hash, manifest, header check, raw load, checks engine, run record, modes, the CSV warning. | 4 to 5 h | |
| 5 | Tests for each check failing and passing (row range, years, classes, negatives, keys, drift, rolling window), and for the "no change" path. | 2 to 3 h | |
| 6 | Freshness checks in `db/risk.sql`, `apply_risk.ts` assertions, rolled-back database test, digest test. | 1.5 to 2 h | |
| 7 | `medicare-refresh.yml` and a check-only run on GitHub against a throwaway database. | 1.5 to 2 h | Secrets decision (D4) |
| 8 | Optional: `--accept-drift` with a recorded reason. | 1 h | |
| 9 | Neon: create the limited login (if D4 says so), apply `pipeline.sql`, `apply_pipeline.ts --neon`, `test_rls_posture.ts --neon`, then the first check run on Neon, then the first apply. Migration before code. | 1 to 1.5 h | Your explicit yes at each Neon step |
| 10 | Clinic data per D3 (option B): `--through`, a test that the old rows are unchanged, regenerate, reload, update `README.md:84` and `docs/data-lineage.md`, rerun `export_bi.ts`, rerun eval case G2. | 2 to 3 h, plus the eval run | D3; model tokens for G2 |
| 11 | Class comparison (section 7) once you supply the Medicaid rules. | 2 to 3 h | The Medicaid list |
| 12 | Update `docs/data-lineage.md`, `README.md` and `docs/decisions.md` with measured numbers only. | 1 h | |

Rough total: 21 to 30 hours. Suggested order: 1, 2, 3, 4, 5, 6, 7, then 9, with 10 and 11 in parallel once you have decided D3 and supplied the list.

## 10. Deliberately left out

- Automating the Medicaid data. It comes from the diabetes-glp1-pipeline project and stays a manual CSV hand-off.
- Finding new CMS release URLs automatically. A person supplies the URL.
- Applying data to Neon from GitHub, and opening pull requests with a new CSV. Applying stays a manual command.
- Alerts by email or chat other than the existing admin page and executive digest.
- Keeping every old raw download in the database. The permanent record is the hash and summary in `app.pipeline_runs`; files live in artifacts or `data/raw/`.
- Handling CMS restatements beyond detecting them and allowing a recorded override.
- New drug classes (for example SGLT2), manufacturer rebates, and a shared class-rules table.
- Any screen for pipeline status. It appears only through the existing data checks.
- Moving the patient and care-risk "today" (2026-10-28).
