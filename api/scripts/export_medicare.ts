import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "csv-parse/sync";
import { classify, toCsv, transformMedicare } from "./medicare_transform.ts";

// Usage (from the api folder):  npx tsx scripts/export_medicare.ts
// Quick manual export: downloads the public CMS file "Medicare Part D Spending by Drug" and writes data/medicare_part_d_annual.csv.
// For the checked, recorded version (hash, raw copy, quality checks, run history) use scripts/pipeline_medicare.ts instead.
// It needs internet. When CMS publishes a newer year, change SOURCE (or pass --url to the pipeline) and run it again.
export const SOURCE =
  "https://data.cms.gov/sites/default/files/2026-06/98218f98-166c-4723-8438-c344a4ef96a6/DSD_PTD_RY26_P04_V10_DY24_BGM.csv";

// test_medicare.ts imports classify from here, so it stays exported.
export { classify };

// Only run the download when this file is started directly, so the rules can be tested on their own.
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const res = await fetch(SOURCE);
  if (!res.ok) throw new Error(`download failed: HTTP ${res.status}`);
  const all = parse(await res.text(), { columns: true, skip_empty_lines: true, bom: true }) as Record<string, string>[];
  const { rows: out, summary: s } = transformMedicare(all);

  const file = fileURLToPath(new URL("../../data/medicare_part_d_annual.csv", import.meta.url));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, toCsv(out));

  // Checks you can read: total per class and year, and what was left out.
  const last = s.years[s.years.length - 1];
  console.log("source drugs (Overall rows):", s.overall_rows, "years:", s.years.join(", "));
  console.log("output rows:", out.length, "written to:", file);
  for (const c of ["GLP-1", "Insulin", "DPP-4", "Metformin"]) {
    console.log(`${last} ${c.padEnd(9)} $${((s.totals[`${last}|${c}`]?.spend ?? 0) / 1e9).toFixed(2)}B`);
  }
  console.log(`${last} four classes = ${s.share[String(last)]}% of all Part D spend`);
  console.log("left out on purpose (look-alike drugs, " + last + " spend):");
  Object.entries(s.left_out).sort((a, b) => b[1] - a[1]).slice(0, 8).forEach(([n, v]) => console.log(`  ${n}  $${(v / 1e9).toFixed(2)}B`));
}
