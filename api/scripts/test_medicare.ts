import assert from "node:assert/strict";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { parse } from "csv-parse/sync";
import { classify } from "./export_medicare.ts";

// Usage (from the api folder):  npx tsx scripts/test_medicare.ts
// Checks the drug-class rules and the exported file. Needs no database and no internet.
const cases: [string, string, string | null, string | null][] = [
  ["Ozempic", "Semaglutide", "GLP-1", "Ozempic"],
  ["Mounjaro", "Tirzepatide", "GLP-1", "Mounjaro"],
  ["Januvia", "Sitagliptin Phosphate", "DPP-4", "Januvia"],
  ["Janumet Xr", "Sitagliptin Phos/Metformin HCl", "DPP-4", "Janumet"],
  ["Lantus Solostar", "Insulin Glargine,Hum.Rec.Anlog", "Insulin", "Lantus"],
  ["Basaglar Kwikpen U-100", "Insulin Glargine,Hum.Rec.Anlog", "Insulin", "Insulin (other)"],
  ["Metformin HCl ER", "Metformin HCl", "Metformin", "Metformin"],
  // left out on purpose
  ["Jardiance", "Empagliflozin", null, null],
  ["Synjardy", "Empagliflozin/Metformin HCl", null, null],
  ["Soliqua 100-33", "Insulin Glargine/Lixisenatide", null, null],
  ["Insulin Syringe", "Insulin Admin. Supplies", null, null],
  ["Omnipod Pods", "Bolus Insulin Pump, 200 Unit", null, null],
  ["Byetta", "Exenatide", null, null],
];
for (const [brand, generic, cls, drug] of cases) {
  const r = classify(brand, generic);
  assert.equal(r?.drug_class ?? null, cls, `${brand}: class`);
  assert.equal(r?.drug ?? null, drug, `${brand}: drug`);
}

const file = fileURLToPath(new URL("../../data/medicare_part_d_annual.csv", import.meta.url));
const rows = parse(fs.readFileSync(file, "utf8"), { columns: true, skip_empty_lines: true }) as Record<string, string>[];
const keys = new Set(rows.map((r) => `${r.year}|${r.drug_class}|${r.drug}`));
assert.equal(keys.size, rows.length, "duplicate year/class/drug rows");
assert.deepEqual([...new Set(rows.map((r) => r.drug_class))].sort(), ["DPP-4", "GLP-1", "Insulin", "Metformin"]);
assert.equal(new Set(rows.map((r) => r.year)).size, 5, "five years");
for (const r of rows) assert.ok(Number(r.spend) > 0 && Number(r.claims) > 0, `non-positive value in ${JSON.stringify(r)}`);
console.log(`ok: ${cases.length} classification cases, ${rows.length} rows checked`);
