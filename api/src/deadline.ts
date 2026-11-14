import { AsyncLocalStorage } from "node:async_hooks";

// Total-time cap for one answer. One request gets one deadline; every model call inside it shares what is left.
export const AGENT_MAX_MS = Number(process.env.AGENT_MAX_MS ?? 60_000);
export const ASSISTANT_MAX_MS = Number(process.env.ASSISTANT_MAX_MS ?? 45_000);

export class TimeLimitError extends Error {
  constructor() {
    super("time limit reached");
  }
}

/** Resolves with the promise, or rejects with TimeLimitError when `ms` run out first. The losing promise is left to finish and is ignored. */
export function withDeadline<T>(p: Promise<T>, ms: number): Promise<T> {
  if (ms <= 0) { p.catch(() => {}); return Promise.reject(new TimeLimitError()); }
  let timer: NodeJS.Timeout;
  const limit = new Promise<never>((_, rej) => { timer = setTimeout(() => rej(new TimeLimitError()), ms); });
  p.catch(() => {});
  return Promise.race([p, limit]).finally(() => clearTimeout(timer));
}

// The assistant routes call the model from several helpers; the deadline travels with the request instead of through every signature.
export const deadlineStore = new AsyncLocalStorage<number>();
export const startDeadline = (ms: number) => (_req: unknown, _res: unknown, next: () => void) => deadlineStore.run(Date.now() + ms, next);
/** Milliseconds left for the current request, or Infinity when no deadline was set. */
export const timeLeft = () => {
  const d = deadlineStore.getStore();
  return d === undefined ? Infinity : d - Date.now();
};
