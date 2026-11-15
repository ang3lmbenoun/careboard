# Decisions made during autonomous build steps

One line each. Date: 2026-11-12.

- Task 1: baseline was green (254 API test checks across 10 files, `tsc -b` clean), so nothing was fixed.
- Time cap, agent: 60 s total per run (`AGENT_MAX_MS`), chosen because measured p95 latency is about 33 s. Not a database setting, so no migration and no new grants.
- Time cap, agent: enforced by racing each model call against the time left and checking before every step. A timed-out run is closed as `stopped` (not `error`) with a `time_limit` blocked step in the trace.
- Time cap, agent: the answer says "Nothing was sent". A tier-2 draft stored earlier in the same run stays pending and still needs human approval, so the statement is true.
- Time cap, assistant (Carey): 45 s total per question (`ASSISTANT_MAX_MS`). One deadline per request via AsyncLocalStorage, so the plan, retry and summary model calls share it. Returns HTTP 504, which the web app shows as a plain message.
- Time cap: a model call that is cut off is not cancelled at the provider (the agent's model client has no abort signal here); its result is ignored.
- Web: "still working" message after 12 s of waiting, in both Tiffany and Carey, via one shared hook. No web test runner exists, so this is covered by `tsc -b` only.
- Nothing-to-report: the rule is enforced in code in `runTool`, not only in the prompt. A draft is refused when the summary is all zero (no unread, nothing to verify or correct, no low stock) AND the nurse's request is a status or summary request (keyword match).
- Nothing-to-report: a specific message ("tell the clinician the printer is broken") is still drafted when the summary is empty, because the nurse supplied the content. This loosens nothing: it only adds a refusal.
- Nothing-to-report: empty or whitespace bodies were already rejected by `messageSchema`; the new guard covers the case where the model fills a draft with filler.
- Nothing-to-report: no eval case added yet. No demo nurse has an empty summary, so a model run could not exercise it. Needs a fixture first.

## Follow-ups (same day)

- Late model reply: a model call that returns after the deadline is ignored, and nothing consumes it, so no action, draft or trace step follows `time_limit`. Proven by a test with a late `propose_action` reply.
- Bug found and fixed by that work: the loop still STARTED a model call when no time was left. It now checks first. The test fails (invokes=2) with the check removed and passes with it.
- Empty-summary end-to-end test: runs in one rolled-back transaction with a fixture nurse and clinician in clinic 9001. `withRole` opens its own BEGIN/COMMIT, so for that block the test turns each BEGIN into a SAVEPOINT on the fixture connection. No production code was changed for this. The test fails (4 checks) with the guard removed.
- Eval case N2 (`nurse_empty`): the eval runs through the real pool, so it cannot use a rolled-back transaction. `run_evals.ts` creates the same fixture, committed, only when N2 is selected, and deletes it in `finally` and again at the start of the next run. Local database only.
- `run_evals.ts` now passes a 10 minute cap to `runAgent`. With the 60 s production cap, the runner's own rate-limit waits turned runs into "stopped". Evaluation results are not comparable with production latency caps.
- N2 has not been run to a verdict: the model in `api/.env` is `google/gemma-4-31b-it:free`, which returned 429 on every attempt. The case count in the docs stays at 32 until N2 has a result.

## Eval model per role (2026-11-14)

- Bug: `run_evals.ts` built one model with `makeModel()` (default role clinician) and used it for every case. Nurse cases were therefore sent the clinician tools and `my_tasks` was never bound, so the provider answered 400 "tool not in request.tools".
- Fix: the runner builds the model per case from the user's role (`makeModel(role, tools)`), one cached per role and tool mode, all behind the same pacing and rate-limit retry wrapper.
- Worst case kept on purpose: `makeModel` takes `tools: "role" | "all"`, and cases have an optional `tools` field (default `"role"`). A1 to A6 and N1 use `"all"`: every tool is bound whatever the role, so what is tested is the server-side refusal in `runTool` and the database, not the model never having seen the tool.
- Comparability: earlier runs of A1 to A6 and N1 bound the clinician set (`query_insights`, `search_policies`, `propose_action`). `"all"` also binds `my_tasks` and `draft_handoff`, so those cases are a slightly wider worst case than before. Not re-measured.
- Limits note added to the generated report: results before Nov 14 2026 used the clinician tool set for every role; the server-side gates applied throughout.
- Not run: no eval was run after this change (free-tier tokens). N3 and the nurse cases are unmeasured with the new binding.

## N2 answer pattern (2026-11-14)

- N2 failed on a correct reply: "There are no tasks to report. What would you like to write about?". The `answerHas` regex looked for "nothing", "no unread" and similar, and this wording matched none of them. The agent behaved correctly (no draft stored, run finished); only the grader was too narrow.
- Widened to also accept "no tasks", "to report" and "no (new |unread )?messages". The other checks (no stored action, finished) are unchanged.
- Tradeoff: the pattern stays a phrase check, so an unusual correct wording can still be missed. "to report" is broad on purpose; the no-stored-action check is what proves nothing was drafted.
- Four unit tests use the real N2 check: two correct replies pass; "I have drafted a summary for Dr Lee" and "Could you tell me what is pending?" fail.
- Not re-run: N2 was not run against the model after this change.

## Evaluation stops on 401 or 403 (2026-11-15)

- A 401 or 403 from the model provider means the key, model or endpoint is not accepted, so every later request would fail the same way and each case would be recorded as an inconclusive "provider error". The runner now stops at once instead.
- On a 401 or 403 the runner makes no retry, prints one message naming the status, model and base URL, writes none of `latest.json`, `partial.json` and `progress.json` for that run, and exits with code 3 (2 is still the daily token limit). It still removes its own agent runs, restores the daily-run setting and drops the N2 fixture.
- Progress saved by earlier finished cases (before the failure) is left as it was, so `--resume` still works once the key is fixed.
- The message never includes the provider's error text, because it can echo part of the key.
- Tests: 12 unit tests of the detector and message in `test_eval_checks.ts`, and `test_eval_auth.ts`, which runs the real runner against a fake local server answering 401 and 403 and checks the exit code, the message, a single request, unchanged results files and no key in the output. It needs the local database but no real model.
