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
