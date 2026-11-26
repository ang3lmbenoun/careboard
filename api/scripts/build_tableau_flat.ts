import fs from "node:fs";
import { fileURLToPath } from "node:url";

// Usage (from the api folder):  npx tsx scripts/build_tableau_flat.ts
// Run after export_bi.ts. Joins bi/data/fact_clinic_daily.csv with dim_date.csv and dim_clinic.csv
// and writes the flat file the Tableau workbook reads: bi/tableau/clinic_daily_flat.csv.
const dataDir = fileURLToPath(new URL("../../bi/data/", import.meta.url));
const outFile = fileURLToPath(new URL("../../bi/tableau/clinic_daily_flat.csv", import.meta.url));

function readCsv(name: string): Record<string, string>[] {
  const lines = fs.readFileSync(dataDir + name, "utf8").split(/\r?\n/).filter((l) => l.length > 0);
  const head = lines[0].split(",");
  return lines.slice(1).map((l) => {
    const v = l.split(",");
    return Object.fromEntries(head.map((h, i) => [h, v[i]]));
  });
}

const dates = new Map(readCsv("dim_date.csv").map((d) => [d.date, d]));
const clinics = new Map(readCsv("dim_clinic.csv").map((c) => [c.clinic_id, c.clinic_name]));
const rows = readCsv("fact_clinic_daily.csv");

const out = ["date,month_start,year,quarter_label,clinic_id,clinic_name,department,scheduled,completed,no_shows"];
for (const r of rows) {
  const d = dates.get(r.date);
  const c = clinics.get(r.clinic_id);
  if (!d) throw new Error(`No dim_date row for ${r.date}. Run export_bi.ts first.`);
  if (!c) throw new Error(`No dim_clinic row for clinic ${r.clinic_id}.`);
  out.push([r.date, d.month_start, d.year, d.quarter_label, r.clinic_id, c, r.department, r.scheduled, r.completed, r.no_shows].join(","));
}
fs.writeFileSync(outFile, out.join("\r\n") + "\r\n");
console.log(`rows: ${rows.length}  first: ${rows[0].date}  last: ${rows[rows.length - 1].date}`);
