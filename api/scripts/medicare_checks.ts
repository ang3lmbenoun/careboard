import type { OutRow, Summary } from "./medicare_transform.ts";

// The eight quality checks from docs/pipeline-plan.md section 3. Pure functions: no database, no download.
// A failed check fails the run; every check runs every time so one run shows everything that is wrong.

export type Check = { n: number; name: string; pass: boolean; value: string; limit: string; note?: string };

export type Baseline = {
  source: string;                       // where the numbers come from, shown in the output
  raw_rows: number;
  overall_rows: number;
  output_rows: number;
  years: number[];
  totals: Summary["totals"];
  share: Summary["share"];
};

// Measured by the one-off download probe on 2026-11-15, used only before the first recorded run.
export const PROBE_BASELINE = { raw_rows: 14536, overall_rows: 3625, share: { "2020": 14.9, "2021": 15.03, "2022": 14.99, "2023": 16.23, "2024": 14.19 } as Record<string, number> };

export const CLASSES = ["DPP-4", "GLP-1", "Insulin", "Metformin"];
export const DRIFT_TOLERANCE = 0.0001; // 0.01 percent (decision D2)
export const SHARE_TOLERANCE = 3;      // percentage points

const within = (x: number, base: number, lo: number, hi: number) => base > 0 && x >= base * lo && x <= base * hi;
const pct = (x: number) => `${(x * 100).toFixed(4)}%`;

export function runChecks(rows: OutRow[], s: Summary, base: Baseline, opts: { acceptDrift?: string } = {}): Check[] {
  const out: Check[] = [];
  const add = (n: number, name: string, pass: boolean, value: string, limit: string, note?: string) => out.push({ n, name, pass, value, limit, note });

  // 1. source row counts
  const a = within(s.source_rows, base.raw_rows, 0.95, 1.2), b = within(s.overall_rows, base.overall_rows, 0.95, 1.15);
  add(1, "Source row count", a && b && s.source_rows > 0, `${s.source_rows} rows, ${s.overall_rows} Overall`,
    `rows ${Math.round(base.raw_rows * 0.95)} to ${Math.round(base.raw_rows * 1.2)}; Overall ${Math.round(base.overall_rows * 0.95)} to ${Math.round(base.overall_rows * 1.15)}`);

  // 2. output row count
  add(2, "Output row count", within(s.output_rows, base.output_rows, 0.9, 1.25), `${s.output_rows} rows`,
    `${Math.floor(base.output_rows * 0.9)} to ${Math.floor(base.output_rows * 1.25)} (0.9 to 1.25 times ${base.output_rows})`);

  // 3. five consecutive years
  const ys = [...new Set(rows.map((r) => r.year))].sort((x, y) => x - y);
  add(3, "Five consecutive years", ys.length === 5 && ys.every((y, i) => i === 0 || y === ys[i - 1] + 1), ys.join(", ") || "none", "exactly 5, consecutive");

  // 4. four classes, each with spend in every year
  const classes = [...new Set(rows.map((r) => r.drug_class))].sort();
  const gaps: string[] = [];
  for (const c of CLASSES) for (const y of ys) if (!(rows.some((r) => r.year === y && r.drug_class === c && r.spend > 0))) gaps.push(`${c} ${y}`);
  add(4, "Four classes with spend every year", JSON.stringify(classes) === JSON.stringify(CLASSES) && gaps.length === 0,
    gaps.length ? `missing: ${gaps.join(", ")}` : classes.join(", "), "GLP-1, Insulin, DPP-4, Metformin, spend above 0 each year");

  // 5. no missing or negative values
  const bad = rows.filter((r) => !Number.isFinite(r.spend) || !Number.isFinite(r.claims) || r.spend < 0 || r.claims < 0 || (r.spend === 0 && r.claims === 0));
  add(5, "No missing or negative values", bad.length === 0 && rows.length > 0, `${bad.length} bad rows of ${rows.length}`, "0");

  // 6. unique keys
  const keys = new Set(rows.map((r) => `${r.year}|${r.drug_class}|${r.drug}`));
  add(6, "Unique year, class, drug", keys.size === rows.length, `${rows.length - keys.size} repeated`, "0");

  // 7. totals against the previous accepted load
  const diffs: string[] = [];
  let compared = 0, worst = 0;
  for (const [k, prev] of Object.entries(base.totals)) {
    const cur = s.totals[k];
    const year = Number(k.split("|")[0]);
    if (!cur) { if (s.totals && year !== Math.min(...base.years)) diffs.push(`${k} missing`); continue; }
    compared++;
    const d = prev.spend === 0 ? (cur.spend === 0 ? 0 : 1) : Math.abs(cur.spend - prev.spend) / prev.spend;
    worst = Math.max(worst, d);
    if (d > DRIFT_TOLERANCE) diffs.push(`${k} ${pct(d)}`);
  }
  const drift = diffs.length > 0;
  add(7, "Totals match the previous load", !drift || !!opts.acceptDrift,
    drift ? `${diffs.length} differ: ${diffs.slice(0, 6).join("; ")}${diffs.length > 6 ? "; ..." : ""}` : `${compared} year/class totals compared, largest change ${pct(worst)}`,
    `at most ${pct(DRIFT_TOLERANCE)} per year and class; only the oldest year may disappear`,
    drift && opts.acceptDrift ? `overridden: ${opts.acceptDrift}` : undefined);

  // 8. share of all Part D spend
  const moves: string[] = [];
  let maxMove = 0;
  for (const [y, prev] of Object.entries(base.share)) {
    if (s.share[y] === undefined) continue;
    const m = Math.abs(s.share[y] - prev);
    maxMove = Math.max(maxMove, m);
    if (m > SHARE_TOLERANCE) moves.push(`${y} ${prev}% to ${s.share[y]}%`);
  }
  add(8, "Share of Part D spend", moves.length === 0, moves.length ? moves.join("; ") : `largest move ${maxMove.toFixed(2)} points`, `within ${SHARE_TOLERANCE} points per year`);
  return out;
}

export const allPass = (c: Check[]) => c.every((x) => x.pass);
