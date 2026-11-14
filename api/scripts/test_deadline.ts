import { TimeLimitError, deadlineStore, startDeadline, timeLeft, withDeadline } from "../src/deadline.js";

// Unit tests for the total-time cap helpers. No database, no network.
let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, extra = "") => {
  cond ? pass++ : fail++;
  console.log(`${cond ? "PASS" : "FAIL"} ${name}${cond ? "" : "  " + extra}`);
};
const sleep = (ms: number, v = "late") => new Promise<string>((r) => setTimeout(() => r(v), ms));

ok("a fast promise passes through", (await withDeadline(sleep(5, "fast"), 500)) === "fast");
let err: unknown;
try { await withDeadline(sleep(300), 30); } catch (e) { err = e; }
ok("a slow promise is cut off with TimeLimitError", err instanceof TimeLimitError);
err = undefined;
try { await withDeadline(sleep(5), 0); } catch (e) { err = e; }
ok("no time left rejects at once", err instanceof TimeLimitError);
err = undefined;
try { await withDeadline(Promise.reject(new Error("model down")), 500); } catch (e) { err = e; }
ok("a real failure is not mistaken for a timeout", err instanceof Error && !(err instanceof TimeLimitError));

ok("without a deadline there is no limit", timeLeft() === Infinity);
await new Promise<void>((done) => startDeadline(1000)({}, {}, async () => {
  const a = timeLeft();
  await sleep(40);
  const b = timeLeft();
  ok("the request deadline is visible across awaits", a <= 1000 && a > 900 && b < a);
  done();
}));
ok("the deadline does not leak outside its request", deadlineStore.getStore() === undefined && timeLeft() === Infinity);
await new Promise<void>((done) => startDeadline(10)({}, {}, async () => {
  await sleep(40);
  ok("an overrun request reports no time left", timeLeft() <= 0);
  done();
}));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
