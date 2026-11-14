---
name: careboard-build-step
description: Use for every CareBoard feature or fix. Runs the same build loop each time: scope, design check against the architecture invariants, migration, tests, eval cases, Neon-before-push deploy order, docs, commit.
---

# CareBoard build step

Follow these stages in order. Do not skip one; say so if a stage does not apply.

## 1. Scope (before any code)
- Restate the goal in one sentence and the user-visible result. Name which roles are affected (admin, clinician, executive, nurse).
- List what you will NOT do in this step. If the request is larger than one verifiable step, split it and ask which part first.
- Read `CLAUDE.md` and the files you will touch. Do not rely on memory of the code.

## 2. Design check against the invariants
Answer each in one line. If any answer is "unsure", stop and ask Angel.
- Does this need a new table, policy or function? Which role gets which grant, and is the table insert-only?
- Could any role read data it should not (check the executive, admin and cross-clinic cases)?
- Does the agent get a new tool? Add it to `ALLOWED` for specific roles only. Is any action tier-2 (needs human approval)?
- Does an answer state figures? Then the grounding gate applies; make sure a tool returns every figure.
- Is there clinical content? The scope guard must still refuse diagnosis, dosing and treatment.

## 3. Build
- Database changes first, as an idempotent `db/*.sql` plus an `api/scripts/apply_*.ts` that ends with PASS/FAIL checks (grants, RLS, policies).
- Then API, then web. Keep new UI in the existing `hm-*` style.
- Add the migration to `api/scripts/ci_setup.sh` in dependency order, and to the Neon setup order in the README.

## 4. Test
- Write tests that fail without the change, including a negative test for each role that must be denied.
- Run `npm test` in `api` and `npx tsc -b` in `web`. Paste the pass counts. Never report success without having run them.
- If agent behavior changed, add cases to `api/eval/cases.ts` and run only those: `npx tsx scripts/run_evals.ts --only=ID1,ID2`.

## 5. Deploy order
1. Apply the migration locally and check it passes.
2. Ask Angel before touching Neon. Then `npx tsx scripts/apply_X.ts --neon` and `npx tsx scripts/test_rls_posture.ts --neon`.
3. Only then commit and, with Angel's yes, push. Check `git status` for `.env` files first.
4. After the deploy: `/api/health`, the Actions run, and one manual check of the new feature on the live site.

## 6. Document and report
- Update the README, `docs/` and `CLAUDE.md` open items, using only measured numbers.
- Final report: what changed, test counts, what was not done, what to do next, and how Angel can verify it (one concrete check).
- Add one line she can use in an interview: what the feature proves and what trade-off was made.
