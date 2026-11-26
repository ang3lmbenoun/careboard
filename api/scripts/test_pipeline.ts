import assert from "node:assert/strict";
import { allPass, CLASSES, runChecks, type Baseline } from "./medicare_checks.ts";
import { toCsv, transformMedicare, type OutRow } from "./medicare_transform.ts";

// Usage (from the api folder):  npx tsx scripts/test_pipeline.ts
// Tests the Medicare transform and the eight pipeline checks on small made-up files. No database, no internet.
const row = (brand: string, generic: string, mftr: string, spend: Record<number, number>, claims: Record<number, number> = {}) => {
  const r: Record<string, string> = { Brnd_Name: brand, Gnrc_Name: generic, Mftr_Name: mftr };
  for (const y of [2020, 2021, 2022, 2023, 2024]) { r[`Tot_Spndng_${y}`] = String(spend[y] ?? 0); r[`Tot_Clms_${y}`] = String(claims[y] ?? (spend[y] ? 10 : 0)); }
  return r;
};
const flat = (v: number) => ({ 2020: v, 2021: v, 2022: v, 2023: v, 2024: v });
const file = [
  row("Ozempic", "Semaglutide", "Overall", flat(1000)),
  row("Ozempic", "Semaglutide", "Novo Nordisk", flat(1000)),          // manufacturer row: must not be added twice
  row("Januvia", "Sitagliptin", "Overall", flat(500)),
  row("Januvia", "Sitagliptin", "Merck", flat(500)),
  row("Lantus Solostar", "Insulin Glargine,Hum.Rec.Anlog", "Overall", flat(300)),
  row("Metformin HCl ER", "Metformin HCl", "Overall", flat(100)),
  row("Mounjaro", "Tirzepatide", "Overall", { 2022: 50, 2023: 200, 2024: 400 }),
  row("Jardiance", "Empagliflozin", "Overall", flat(5000)),           // left out on purpose, but counts in the Part D total
  row("Lisinopril", "Lisinopril", "Overall", flat(4000)),
];
const { rows, summary } = transformMedicare(file);

// transform
assert.equal(summary.overall_rows, 7, "only Overall rows are kept");
assert.equal(summary.source_rows, 9);
assert.deepEqual(summary.years, [2020, 2021, 2022, 2023, 2024]);
assert.equal(rows.find((r) => r.year === 2024 && r.drug === "Ozempic")?.spend, 1000, "manufacturer row not double counted");
assert.equal(rows.filter((r) => r.drug === "Mounjaro").length, 3, "years before launch are dropped");
assert.ok(!rows.some((r) => r.drug === "Jardiance"), "SGLT2 is left out");
assert.equal(summary.totals["2024|GLP-1"].spend, 1400);
assert.equal(summary.share["2020"], Math.round((1900 / 10900) * 1e4) / 100, "share uses all Overall spend");
assert.match(toCsv(rows).split("\n")[0], /^year,drug_class,drug,claims,spend$/);
assert.equal(transformMedicare([]).rows.length, 0, "empty file gives no rows");

const base: Baseline = { source: "test", raw_rows: summary.source_rows, overall_rows: summary.overall_rows, output_rows: summary.output_rows, years: summary.years, totals: summary.totals, share: summary.share };
const names = (c: ReturnType<typeof runChecks>) => c.filter((x) => !x.pass).map((x) => x.n);

// the same data passes every check
let c = runChecks(rows, summary, base);
assert.equal(c.length, 8);
assert.ok(allPass(c), JSON.stringify(c.filter((x) => !x.pass)));

// 1 and 2: row counts
c = runChecks(rows, { ...summary, source_rows: 100 }, base);
assert.deepEqual(names(c), [1]);
c = runChecks(rows.slice(0, 5), { ...summary, output_rows: 5 }, base);
assert.ok(names(c).includes(2));

// 3: a sixth year, and a missing year
const withSixth: OutRow[] = [...rows, { year: 2025, drug_class: "GLP-1", drug: "Ozempic", claims: 1, spend: 1 }];
assert.ok(names(runChecks(withSixth, summary, base)).includes(3));
assert.ok(names(runChecks(rows.filter((r) => r.year !== 2022), summary, base)).includes(3));

// 4: a class disappears
assert.ok(names(runChecks(rows.filter((r) => r.drug_class !== "Metformin"), summary, base)).includes(4));
assert.deepEqual(CLASSES, ["DPP-4", "GLP-1", "Insulin", "Metformin"]);

// 5: negative and missing values
assert.ok(names(runChecks(rows.map((r, i) => (i === 0 ? { ...r, spend: -1 } : r)), summary, base)).includes(5));
assert.ok(names(runChecks(rows.map((r, i) => (i === 0 ? { ...r, claims: NaN } : r)), summary, base)).includes(5));

// 6: duplicate key
assert.ok(names(runChecks([...rows, rows[0]], summary, base)).includes(6));

// 7: drift, override, rolling window
const moved = { ...summary, totals: { ...summary.totals, "2024|GLP-1": { spend: 1400 * 1.001, claims: 1 } } };
assert.deepEqual(names(runChecks(rows, moved, base)), [7]);
c = runChecks(rows, moved, base, { acceptDrift: "CMS restated 2024" });
assert.ok(allPass(c) && c[6].note?.includes("CMS restated 2024"), "override passes check 7 and keeps the reason");
const tiny = { ...summary, totals: { ...summary.totals, "2024|GLP-1": { spend: 1400 * 1.00005, claims: 1 } } };
assert.ok(allPass(runChecks(rows, tiny, base)), "0.005 percent is inside the tolerance");
const rolled = { ...summary, totals: Object.fromEntries(Object.entries(summary.totals).filter(([k]) => !k.startsWith("2020|"))) };
assert.ok(!names(runChecks(rows, rolled, base)).includes(7), "the oldest year may disappear");
const lostMid = { ...summary, totals: Object.fromEntries(Object.entries(summary.totals).filter(([k]) => !k.startsWith("2022|"))) };
assert.ok(names(runChecks(rows, lostMid, base)).includes(7), "a middle year may not disappear");
assert.ok(!names(runChecks(rows, { ...summary, overall_rows: base.overall_rows }, { ...base, totals: {} })).includes(7), "no baseline totals, nothing to compare");

// 8: share moves
assert.deepEqual(names(runChecks(rows, { ...summary, share: { ...summary.share, "2024": summary.share["2024"] + 3.5 } }, base)), [8]);

console.log("ok: transform and 8 checks, including failing cases");
