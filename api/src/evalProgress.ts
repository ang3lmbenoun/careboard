// Pure helpers for the evaluation runner: the per-request model timeout and the resume rules. No database, no network,
// so they can be unit tested (scripts/test_eval_checks.ts) without running an evaluation.
import { TimeLimitError, withDeadline } from "./deadline.js";

/** Every model request in an evaluation gets this long. */
export const MODEL_TIMEOUT_MS = 90_000;
/** The error message a timed-out request carries. The runner recognises it by this text. */
export const MODEL_TIMEOUT_TEXT = "model request timed out";
export const isModelTimeout = (message: string | undefined | null) => /model request timed out/i.test(message ?? "");

/**
 * Resolves with the promise, or rejects with a plain Error ("model request timed out after N s") when `ms` run out first.
 * It is deliberately NOT a TimeLimitError: runAgent treats that as the run's own time cap and would close the run as "stopped"
 * instead of reporting a provider error. The late reply, if any, is ignored (the request cannot be cancelled here).
 */
export async function withModelTimeout<T>(p: Promise<T>, ms: number = MODEL_TIMEOUT_MS): Promise<T> {
  try { return await withDeadline(p, ms); }
  catch (e) { if (e instanceof TimeLimitError) throw new Error(`${MODEL_TIMEOUT_TEXT} after ${Math.round(ms / 1000)} s`); throw e; }
}

/** How many times a failed run is tried again: a timeout once, any other provider error twice. After that the run is inconclusive. */
export const retriesAllowed = (error: string | undefined | null) => (isModelTimeout(error) ? 1 : 2);

export type SavedResult = { id: string; question: string; run: number; status: string; inconclusive?: boolean };
export type Progress<R extends SavedResult = SavedResult> = { model: string; baseURL: string; repeat: number; retries?: number; results: R[] };

/** Why a progress file cannot be resumed with these settings, or null if it can. Results from different models are never merged. */
export function resumeProblem(p: Partial<Progress> | null | undefined, now: { model: string; baseURL: string; repeat: number }): string | null {
  if (!p || !Array.isArray(p.results)) return "progress.json is unreadable";
  if (p.model !== now.model || p.baseURL !== now.baseURL || p.repeat !== now.repeat)
    return `progress.json was made with model ${p.model} via ${p.baseURL}, repeat ${p.repeat}; this run uses ${now.model} via ${now.baseURL}, repeat ${now.repeat}`;
  return null;
}

/**
 * Cases that can be skipped on resume: all repeats are saved, the question is unchanged since, nothing was skipped for a missing
 * account, and no run was inconclusive (those are exactly the ones worth running again).
 */
export function finishedCases<R extends SavedResult>(saved: R[], cases: { id: string; question: string }[], repeat: number): { done: Set<string>; results: R[] } {
  const done = new Set<string>();
  const results: R[] = [];
  for (const c of cases) {
    const rs = saved.filter((r) => r.id === c.id);
    const runs = new Set(rs.map((r) => r.run));
    const complete = rs.length === repeat && runs.size === repeat && rs.every((r) => r.question === c.question && r.status !== "skipped" && !r.inconclusive);
    if (complete) { done.add(c.id); results.push(...rs); }
  }
  return { done, results };
}

/**
 * 401 or 403 from the model provider (wrong, missing or expired key, or no permission for the model), or null for any other error.
 * Recognised by a status field on the error (the OpenAI client sets one), or by the status leading the message, or by the status
 * next to an authorization word. A 429 or a timeout is not one of these.
 */
export function authFailureStatus(e: unknown): 401 | 403 | null {
  const x = e as any;
  const status = Number(x?.status ?? x?.response?.status ?? x?.cause?.status);
  if (status === 401 || status === 403) return status;
  const msg = String(x?.message ?? e ?? "");
  const lead = /^\s*(?:error:?\s*)?(401|403)\b/i.exec(msg);
  if (lead) return Number(lead[1]) as 401 | 403;
  const near = /\b(401|403)\b[\s\S]{0,80}(unauthori[sz]ed|forbidden|invalid[\s\S]{0,20}key|authentication|permission)/i.exec(msg);
  return near ? (Number(near[1]) as 401 | 403) : null;
}

/** The message printed when a run is stopped for a 401 or 403. It names the status only: provider error text can echo part of a key. */
export function authAbortMessage(status: 401 | 403, model: string, baseURL: string): string {
  const why = status === 401 ? "unauthorized: the key is missing, wrong or expired" : "forbidden: the key is not allowed to use this model or endpoint";
  return `Stopped at once: the model provider answered ${status} (${why}). Model ${model} via ${baseURL}. Check EVAL_API_KEY (or GROQ_API_KEY) and EVAL_MODEL in api/.env. Nothing was written: latest.json, partial.json and progress.json are unchanged.`;
}
