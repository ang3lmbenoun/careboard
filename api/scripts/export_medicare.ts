import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "csv-parse/sync";

// Usage (from the api folder):  npx tsx scripts/export_medicare.ts
// Builds data/medicare_part_d_annual.csv from the public CMS file "Medicare Part D Spending by Drug".
// It needs internet, and writes the same four drug classes the Medicaid data uses so the two can be compared.
// When CMS publishes a newer year, change SOURCE and run it again.
const SOURCE =
  "https://data.cms.gov/sites/default/files/2026-06/98218f98-166c-4723-8438-c344a4ef96a6/DSD_PTD_RY26_P04_V10_DY24_BGM.csv";

// The Medicaid classes come from a fixed list of brand names, so Medicare uses the same list.
const GLP1 = ["ozempic", "wegovy", "rybelsus", "mounjaro", "zepbound", "trulicity", "victoza"];
const DPP4 = ["januvia", "janumet", "onglyza", "tradjenta"];
const NAMED_INSULIN = ["humalog", "lantus", "levemir", "novolog", "tresiba"];

type Hit = { drug_class: string; drug: string };

export function classify(brand: string, generic: string): Hit | null {
  const b = brand.trim().toLowerCase();
  const g = generic.trim().toLowerCase();
  const first = (list: string[]) => list.find((x) => b.startsWith(x));
  const glp = first(GLP1);
  if (glp) return { drug_class: "GLP-1", drug: cap(glp) };
  const dpp = first(DPP4);
  if (dpp) return { drug_class: "DPP-4", drug: cap(dpp) };
  if (g === "metformin hcl") return { drug_class: "Metformin", drug: "Metformin" };
  const ins = g.includes("insulin") && !/lixisenatide|liraglutide|supplies|pump|needle/.test(g);
  if (ins) {
    const named = first(NAMED_INSULIN);
    return { drug_class: "Insulin", drug: named ? cap(named) : "Insulin (other)" };
  }
  return null;
}
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// Only run the download when this file is started directly, so the rules above can be tested on their own.
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const res = await fetch(SOURCE);
  if (!res.ok) throw new Error(`download failed: HTTP ${res.status}`);
  const all = parse(await res.text(), { columns: true, skip_empty_lines: true, bom: true }) as Record<string, string>[];

  // The file holds one "Overall" row per drug plus one row per manufacturer. Adding them all would count spend twice.
  const rows = all.filter((r) => r.Mftr_Name === "Overall");
  const years = Object.keys(rows[0])
    .map((k) => /^Tot_Spndng_(\d{4})$/.exec(k)?.[1])
    .filter((y): y is string => !!y)
    .map(Number)
    .sort();

  const sums = new Map<string, { year: number; drug_class: string; drug: string; claims: number; spend: number }>();
  const missed = new Map<string, number>();
  for (const r of rows) {
    const hit = classify(r.Brnd_Name, r.Gnrc_Name);
    if (!hit) {
      // Remember look-alike drugs we left out on purpose, so the exclusions are visible.
      if (/glutide|gliptin|gliflozin|insulin|metformin/i.test(r.Gnrc_Name)) {
        missed.set(r.Gnrc_Name, (missed.get(r.Gnrc_Name) ?? 0) + Number(r[`Tot_Spndng_${years[years.length - 1]}`] || 0));
      }
      continue;
    }
    for (const y of years) {
      const k = `${y}|${hit.drug_class}|${hit.drug}`;
      const s = sums.get(k) ?? { year: y, ...hit, claims: 0, spend: 0 };
      s.claims += Number(r[`Tot_Clms_${y}`] || 0);
      s.spend += Number(r[`Tot_Spndng_${y}`] || 0);
      sums.set(k, s);
    }
  }

  // A drug that was not on the market yet has zero rows for earlier years; leave those out.
  const out = [...sums.values()].filter((r) => r.spend > 0 || r.claims > 0).sort(
    (a, b) => a.year - b.year || a.drug_class.localeCompare(b.drug_class) || a.drug.localeCompare(b.drug)
  );
  const cols = ["year", "drug_class", "drug", "claims", "spend"] as const;
  const esc = (v: unknown) => `"${String(v).replaceAll('"', '""')}"`;
  const csv = [cols.join(","), ...out.map((r) => cols.map((c) => esc(c === "spend" ? r.spend.toFixed(2) : r[c])).join(","))].join("\n");
  const file = fileURLToPath(new URL("../../data/medicare_part_d_annual.csv", import.meta.url));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, csv + "\n");

  // Checks you can read: total per class and year, and what was left out.
  const last = years[years.length - 1];
  const sourceTotal = rows.reduce((a, r) => a + Number(r[`Tot_Spndng_${last}`] || 0), 0);
  const kept = out.filter((r) => r.year === last).reduce((a, r) => a + r.spend, 0);
  console.log("source drugs (Overall rows):", rows.length, "years:", years.join(", "));
  console.log("output rows:", out.length, "written to:", file);
  for (const c of ["GLP-1", "Insulin", "DPP-4", "Metformin"]) {
    const t = out.filter((r) => r.year === last && r.drug_class === c).reduce((a, r) => a + r.spend, 0);
    console.log(`${last} ${c.padEnd(9)} $${(t / 1e9).toFixed(2)}B`);
  }
  console.log(`${last} four classes = ${((kept / sourceTotal) * 100).toFixed(1)}% of all Part D spend ($${(sourceTotal / 1e9).toFixed(0)}B)`);
  console.log("left out on purpose (look-alike drugs, " + last + " spend):");
  [...missed.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).forEach(([n, v]) => console.log(`  ${n}  $${(v / 1e9).toFixed(2)}B`));
}
