import "dotenv/config";
import fs from "node:fs";
import { spawn } from "node:child_process";

// Checks the admin-only /eval/latest route. Writes a temporary results file only if none exists, and removes it afterwards.
// Usage (from the api folder):  npx tsx scripts/test_eval_route.ts
let pass = 0, fail = 0;
const ok = (n: string, c: boolean, x = "") => { c ? pass++ : fail++; console.log(`${c ? "PASS" : "FAIL"} ${n}${c ? "" : "  " + x}`); };

const file = new URL("../eval/results/latest.json", import.meta.url);
const existed = fs.existsSync(file);
if (!existed) { fs.mkdirSync(new URL("../eval/results/", import.meta.url), { recursive: true }); fs.writeFileSync(file, JSON.stringify({ model: "test", cases: 0, runs: 0, passed: 0, failed: 0, categories: [], caseRows: [], suites: [] })); }

const PORT = "4597";
const srv = spawn(process.execPath, ["--import", "tsx", "src/server.ts"], { env: { ...process.env, PORT }, stdio: "ignore" });
const base = `http://127.0.0.1:${PORT}`;
for (let i = 0; i < 40; i++) { try { if ((await fetch(base + "/health")).ok) break; } catch {} await new Promise((r) => setTimeout(r, 500)); }
const login = async (email: string) => { const r = await fetch(base + "/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password: process.env.DEMO_PASSWORD }) }); return r.ok ? ((await r.json()) as any).token as string : ""; };
const get = (t: string) => fetch(base + "/eval/latest", { headers: t ? { authorization: `Bearer ${t}` } : {} });
try {
  const [ta, tc, te, tn] = await Promise.all(["admin", "clinician", "executive", "nurse"].map((x) => login(`${x}@careboard.dev`)));
  ok("admin can read results", (await get(ta)).status === 200);
  ok("clinician refused", (await get(tc)).status === 403);
  ok("executive refused", (await get(te)).status === 403);
  ok("nurse refused", (await get(tn)).status === 403);
  ok("no token refused", (await get("")).status === 401);
  if (existed) ok("results file has a model name", typeof (await (await get(ta)).json() as any).model === "string");
} finally {
  srv.kill();
  if (!existed) fs.rmSync(file);
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
