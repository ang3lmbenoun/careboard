import "dotenv/config";
import { execSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { parse } from "csv-parse/sync";
import pg from "pg";
import { allPass, PROBE_BASELINE, runChecks, type Baseline, type Check } from "./medicare_checks.ts";
import { SOURCE } from "./export_medicare.ts";
import { toCsv, transformMedicare, yearsOf, type OutRow, type Summary } from "./medicare_transform.ts";

// Usage (from the api folder):
//   npx tsx scripts/pipeline_medicare.ts                      check only: download, save, load raw, run 8 checks, record the run
//   npx tsx scripts/pipeline_medicare.ts --apply              also replace serving.medicare_part_d_annual when every check passes
//   npx tsx scripts/pipeline_medicare.ts --neon [--apply]     same against Neon (asks you to type APPLY before it changes Neon)
//   options: --url=<CMS csv url>  --accept-drift="reason" (overrides check 7 only)  --trigger=schedule (set by the workflow)
// Plan and reasons for every rule: docs/pipeline-plan.md. Never touches the Medicaid or clinic tables.
const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const flag = (n: string) => process.argv.includes(`--${n}`);
const neon = flag("neon"), apply = flag("apply");
const url = arg("url") ?? SOURCE;
const acceptDrift = arg("accept-drift");
const trigger = arg("trigger") === "schedule" ? "schedule" : "manual";
const target = neon ? "neon" : process.env.CI ? "ci" : "local";
const adminUrl = neon ? process.env.NEON_ADMIN_URL : process.env.ADMIN_DATABASE_URL;
if (!adminUrl) throw new Error(neon ? "NEON_ADMIN_URL missing in api/.env" : "ADMIN_DATABASE_URL missing in api/.env");
if (acceptDrift !== undefined && !acceptDrift.trim()) throw new Error('--accept-drift needs a reason, e.g. --accept-drift="CMS restated 2024"');

const root = fileURLToPath(new URL("../../", import.meta.url));
const db = new pg.Pool({ connectionString: adminUrl });
const loadId = crypto.randomUUID();
const startedAt = new Date();
const PIPELINE = "medicare_part_d";
const line = (s = "") => console.log(s);
const gitSha = () => process.env.GITHUB_SHA ?? (() => { try { return execSync("git rev-parse HEAD", { cwd: root, stdio: ["ignore", "pipe", "ignore"] }).toString().trim(); } catch { return null; } })();

type Run = { status: "success" | "no_change" | "checked" | "failed"; sha256?: string; bytes?: number; downloaded_at?: Date; raw_rows?: number; output_rows?: number;
  years?: number[]; summary?: Summary; checks?: Check[]; error?: string };
async function record(r: Run) {
  await db.query(
    `INSERT INTO app.pipeline_runs (load_id, pipeline, trigger, target, status, started_at, source_url, sha256, bytes, downloaded_at, raw_rows, output_rows, years, summary, checks, drift_reason, error, git_sha)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
    [loadId, PIPELINE, trigger, target, r.status, startedAt, url, r.sha256 ?? null, r.bytes ?? null, r.downloaded_at ?? null, r.raw_rows ?? null, r.output_rows ?? null,
     r.years ?? null, r.summary ? JSON.stringify(r.summary) : null, r.checks ? JSON.stringify(r.checks) : null,
     r.checks?.some((c) => c.note?.startsWith("overridden")) ? acceptDrift : null, r.error ?? null, gitSha()]);
}

async function baseline(): Promise<Baseline> {
  const prev = (await db.query(`SELECT raw_rows, output_rows, years, summary FROM app.pipeline_runs
     WHERE pipeline = $1 AND status = 'success' AND summary IS NOT NULL ORDER BY id DESC LIMIT 1`, [PIPELINE])).rows[0];
  if (prev) {
    const s = prev.summary as Summary;
    return { source: "last applied run", raw_rows: prev.raw_rows, overall_rows: s.overall_rows, output_rows: prev.output_rows, years: prev.years, totals: s.totals, share: s.share };
  }
  // No applied run yet: compare with what is loaded in the serving table (from the committed CSV) and the probe numbers.
  const t = (await db.query(`SELECT year, drug_class, sum(spend)::float8 AS spend, sum(claims)::float8 AS claims, count(*)::int AS n FROM serving.medicare_part_d_annual GROUP BY 1, 2`)).rows;
  const totals: Summary["totals"] = {};
  for (const r of t) totals[`${r.year}|${r.drug_class}`] = { spend: r.spend, claims: r.claims };
  return { source: "serving table loaded from the committed CSV + probe of 2026-11-15", raw_rows: PROBE_BASELINE.raw_rows, overall_rows: PROBE_BASELINE.overall_rows,
    output_rows: t.reduce((a, r) => a + r.n, 0), years: [...new Set<number>(t.map((r) => r.year))].sort(), totals, share: PROBE_BASELINE.share };
}

async function main(): Promise<number> {
  line(`Medicare Part D pipeline, target: ${target}, mode: ${apply ? "check and apply" : "check only"}, load ${loadId}`);

  // 1. download, with the stop conditions from the plan
  const res = await fetch(url, { headers: { "accept-encoding": "gzip" } });
  if (res.status !== 200) throw new Error(`download failed: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());   // fetch has already undone gzip: these are the decompressed bytes
  const downloadedAt = new Date();
  if (buf.length === 0) throw new Error("download failed: empty body");
  const sha256 = crypto.createHash("sha256").update(buf).digest("hex");
  const text = buf.toString("utf8");
  const all = parse(text, { columns: true, skip_empty_lines: true, bom: true }) as Record<string, string>[];
  const header = all.length ? Object.keys(all[0]) : [];
  const yrs = yearsOf(header);
  const missing = ["Mftr_Name", "Brnd_Name", "Gnrc_Name"].filter((c) => !header.includes(c));
  if (!yrs.length || !yrs.some((y) => header.includes(`Tot_Clms_${y}`))) missing.push("Tot_Spndng_YYYY / Tot_Clms_YYYY");
  if (missing.length) throw new Error(`the file does not look like the CMS Part D file; missing columns: ${missing.join(", ")}`);
  line(`downloaded ${buf.length.toLocaleString()} bytes, ${all.length.toLocaleString()} data rows, ${header.length} columns, sha256 ${sha256}`);

  // 2. keep the raw copy and a manifest next to it
  const day = downloadedAt.toISOString().slice(0, 10);
  const stem = path.basename(new URL(url).pathname).replace(/\.csv$/i, "");
  const dir = path.join(root, "data", "raw", "medicare_part_d");
  const base = path.join(dir, `${day}_${stem}_${sha256.slice(0, 12)}`);
  fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(base + ".csv")) fs.writeFileSync(base + ".csv", buf);
  fs.writeFileSync(base + ".json", JSON.stringify({
    source_url: url, downloaded_at_utc: downloadedAt.toISOString(), sha256, sha256_covers: "decompressed bytes", bytes: buf.length, http_status: res.status,
    etag: res.headers.get("etag"), last_modified: res.headers.get("last-modified"), data_rows: all.length, years: yrs, git_sha: gitSha(), trigger, target, load_id: loadId,
  }, null, 2) + "\n");
  line(`saved ${path.relative(root, base)}.csv and .json`);

  // 3. same file as the last applied load: nothing to do, but the check still counts for freshness
  const last = (await db.query(`SELECT sha256 FROM app.pipeline_runs WHERE pipeline = $1 AND status IN ('success','no_change') ORDER BY id DESC LIMIT 1`, [PIPELINE])).rows[0];
  if (last?.sha256 === sha256) {
    await record({ status: "no_change", sha256, bytes: buf.length, downloaded_at: downloadedAt, raw_rows: all.length, years: yrs });
    line("RESULT: no change. This is the same file as the last load. Serving table untouched, run recorded.");
    return 0;
  }

  // 4. raw table: the downloaded rows, unchanged, replaced on every run
  const c = await db.connect();
  try {
    await c.query("BEGIN");
    await c.query("TRUNCATE raw.medicare_part_d_spending");
    for (let i = 0; i < all.length; i += 500) {
      const part = all.slice(i, i + 500).map((r, j) => ({ l: i + j + 1, b: r.Brnd_Name ?? null, g: r.Gnrc_Name ?? null, m: r.Mftr_Name ?? null, f: r }));
      await c.query(`INSERT INTO raw.medicare_part_d_spending (load_id, line_no, brnd_name, gnrc_name, mftr_name, fields)
        SELECT $1, (x->>'l')::int, x->>'b', x->>'g', x->>'m', x->'f' FROM jsonb_array_elements($2::jsonb) x`, [loadId, JSON.stringify(part)]);
    }
    await c.query("COMMIT");
  } catch (e) { await c.query("ROLLBACK"); throw e; } finally { c.release(); }
  const n = (await db.query("SELECT count(*)::int AS n FROM raw.medicare_part_d_spending WHERE load_id = $1", [loadId])).rows[0].n;
  if (n !== all.length) throw new Error(`raw table holds ${n} rows but the file has ${all.length}`);
  line(`raw.medicare_part_d_spending: ${n.toLocaleString()} rows loaded`);

  // 5. transform from the raw table (not from memory), then the checks
  const fromRaw = (await db.query("SELECT fields FROM raw.medicare_part_d_spending WHERE load_id = $1 ORDER BY line_no", [loadId])).rows.map((r) => r.fields as Record<string, string>);
  const { rows, summary } = transformMedicare(fromRaw);
  const bl = await baseline();
  line(`compared with: ${bl.source}`);
  const checks = runChecks(rows, summary, bl, { acceptDrift });
  line();
  for (const k of checks) line(`${k.pass ? "PASS" : "FAIL"} ${k.n}. ${k.name}: ${k.value}  [${k.limit}]${k.note ? "  (" + k.note + ")" : ""}`);
  const last2 = summary.years[summary.years.length - 1], prev2 = summary.years[summary.years.length - 2];
  line();
  line(`recorded, not a check: ${prev2} to ${last2} change by class`);
  for (const cl of ["GLP-1", "Insulin", "DPP-4", "Metformin"]) {
    const a = summary.totals[`${prev2}|${cl}`]?.spend ?? 0, b = summary.totals[`${last2}|${cl}`]?.spend ?? 0;
    line(`  ${cl.padEnd(9)} $${(a / 1e9).toFixed(2)}B -> $${(b / 1e9).toFixed(2)}B (${a ? (((b - a) / a) * 100).toFixed(1) : "n/a"}%)`);
  }

  const common = { sha256, bytes: buf.length, downloaded_at: downloadedAt, raw_rows: all.length, output_rows: rows.length, years: summary.years, summary, checks };
  if (!allPass(checks)) {
    const failedNames = checks.filter((k) => !k.pass).map((k) => `${k.n}. ${k.name}`).join("; ");
    await record({ ...common, status: "failed", error: `failed checks: ${failedNames}` });
    line(`\nRESULT: FAILED (${failedNames}). Serving table untouched. Raw rows kept in raw.medicare_part_d_spending for inspection. Run recorded.`);
    return 1;
  }

  // 6. candidate CSV, so git and the database stay in step
  const csvFile = path.join(root, "data", "medicare_part_d_annual.csv");
  const csv = toCsv(rows);
  const same = fs.existsSync(csvFile) && fs.readFileSync(csvFile, "utf8") === csv;
  fs.writeFileSync(csvFile, csv);

  if (!apply) {
    await record({ ...common, status: "checked" });
    line(`\nRESULT: all checks passed. Nothing applied. ${same ? "data/medicare_part_d_annual.csv is identical to the committed file." : "data/medicare_part_d_annual.csv now holds the candidate (differs from the committed file)."}`);
    return 0;
  }

  if (neon) {
    if (!process.stdin.isTTY) throw new Error("refusing to change Neon without an interactive confirmation");
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const a = await rl.question(`\nThis replaces serving.medicare_part_d_annual on NEON with ${rows.length} rows. Type APPLY to continue: `);
    rl.close();
    if (a.trim() !== "APPLY") throw new Error("not confirmed, nothing changed");
  }
  await applyRows(rows);
  await record({ ...common, status: "success" });
  line(`\nRESULT: applied ${rows.length} rows to serving.medicare_part_d_annual on ${target}. Run recorded.`);
  line(same ? "The CSV in git already matches." : "NEXT: commit data/medicare_part_d_annual.csv and the new file under data/raw/, otherwise load_serving.ts will reload the old data.");
  return 0;
}

async function applyRows(rows: OutRow[]) {
  const c = await db.connect();
  try {
    await c.query("BEGIN");
    await c.query("TRUNCATE serving.medicare_part_d_annual");
    await c.query(`INSERT INTO serving.medicare_part_d_annual (year, drug_class, drug, claims, spend)
      SELECT * FROM unnest($1::int[], $2::text[], $3::text[], $4::numeric[], $5::numeric[])`,
      [rows.map((r) => r.year), rows.map((r) => r.drug_class), rows.map((r) => r.drug), rows.map((r) => r.claims), rows.map((r) => r.spend.toFixed(2))]);
    await c.query("COMMIT");
  } catch (e) { await c.query("ROLLBACK"); throw e; } finally { c.release(); }
}

let code = 1;
try { code = await main(); }
catch (e: any) {
  console.error("ERROR:", e.message);
  try { await record({ status: "failed", error: String(e.message).slice(0, 500) }); console.error("The failed run was recorded in app.pipeline_runs."); }
  catch { console.error("The failed run could not be recorded (is db/pipeline.sql applied?)."); }
} finally { await db.end(); }
process.exit(code);
