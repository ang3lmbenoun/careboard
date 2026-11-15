import "dotenv/config";
import fs from "node:fs";
import http from "node:http";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

// Runs the real evaluation runner against a fake model server that answers 401 (and then 403), and checks that the run stops at
// once with a clear message and a non-zero exit, makes no second request, writes none of latest.json / partial.json / progress.json,
// and never prints the key. It needs the LOCAL database (the runner connects to it before the first model call) but no real model.
// Usage (api folder): npx tsx scripts/test_eval_auth.ts
let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, extra = "") => { cond ? pass++ : fail++; console.log(`${cond ? "PASS" : "FAIL"} ${name}${cond ? "" : "  " + extra}`); };

const dir = fileURLToPath(new URL("../eval/results/", import.meta.url));
const files = ["latest.json", "partial.json", "progress.json"].map((f) => dir + f);
const snapshot = () => files.map((f) => (fs.existsSync(f) ? fs.readFileSync(f) : null));
const same = (a: (Buffer | null)[], b: (Buffer | null)[]) => a.every((x, i) => (x === null ? b[i] === null : b[i] !== null && x.equals(b[i]!)));
const KEY = "sk-test-secret-key-do-not-print";

async function runWith(status: number) {
  let requests = 0;
  const srv = http.createServer((req, res) => {
    requests++;
    req.resume();
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: { message: `Incorrect API key provided: ${KEY}`, type: "invalid_request_error", code: "invalid_api_key" } }));
  });
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", () => r()));
  const port = (srv.address() as any).port;
  const before = snapshot();
  const child = spawn(process.execPath, ["--import", "tsx", "scripts/run_evals.ts", "--gap=0"], {
    env: { ...process.env, EVAL_API_KEY: KEY, EVAL_BASE_URL: `http://127.0.0.1:${port}/v1`, EVAL_MODEL: "fake-model" },
  });
  let out = "", err = "";
  child.stdout.on("data", (d) => (out += d));
  child.stderr.on("data", (d) => (err += d));
  const killer = setTimeout(() => child.kill(), 120_000);
  const code: number | null = await new Promise((r) => child.on("close", r));
  clearTimeout(killer);
  const after = snapshot();
  // Put back anything a faulty run changed, so a failing test never costs real results.
  files.forEach((f, i) => { if (before[i] === null) { if (after[i] !== null) fs.rmSync(f, { force: true }); } else if (after[i] === null || !before[i]!.equals(after[i]!)) fs.writeFileSync(f, before[i]!); });
  await new Promise<void>((r) => srv.close(() => r()));
  return { code, out, err, requests, unchanged: same(before, after) };
}

for (const status of [401, 403]) {
  const r = await runWith(status);
  ok(`a ${status} stops the run with a non-zero exit`, r.code !== null && r.code !== 0, `exit=${r.code}\n${r.err.slice(-400)}`);
  ok(`a ${status} prints a clear message naming the status`, new RegExp(`Stopped at once.*${status}`).test(r.err), r.err.slice(-400));
  ok(`a ${status} sends one model request, not a retry loop`, r.requests === 1, `requests=${r.requests}`);
  ok(`a ${status} writes none of latest.json, partial.json, progress.json`, r.unchanged);
  ok(`a ${status} never prints the key`, !(r.out + r.err).includes(KEY));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
