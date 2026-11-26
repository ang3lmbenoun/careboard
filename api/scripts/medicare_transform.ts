// The Medicare Part D rules, kept apart from any download or database code so tests can run them on small fixtures.
// export_medicare.ts and pipeline_medicare.ts both call transformMedicare(); nothing else decides which drugs count.

// Copy of the Medicaid brand lists (seed in the diabetes-glp1-pipeline project), compared on 2026-11-17.
// GLP-1, DPP-4 and named insulin brands match. Insulin "other" and metformin are matched differently; see docs/data-lineage.md.
const GLP1 = ["ozempic", "wegovy", "rybelsus", "mounjaro", "zepbound", "trulicity", "victoza"];
const DPP4 = ["januvia", "janumet", "onglyza", "tradjenta"];
const NAMED_INSULIN = ["humalog", "lantus", "levemir", "novolog", "tresiba"];

export type Hit = { drug_class: string; drug: string };
export type OutRow = { year: number; drug_class: string; drug: string; claims: number; spend: number };
export type Summary = {
  years: number[];
  source_rows: number;
  overall_rows: number;
  output_rows: number;
  /** "year|class" -> spend and claims, used by the next run's comparison */
  totals: Record<string, { spend: number; claims: number }>;
  /** year -> percent of all Part D spend that the four classes make up */
  share: Record<string, number>;
  /** look-alike drugs left out on purpose, newest-year spend */
  left_out: Record<string, number>;
};

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

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

/** Years found in the column names, e.g. Tot_Spndng_2024. */
export function yearsOf(columns: string[]): number[] {
  return columns
    .map((k) => /^Tot_Spndng_(\d{4})$/.exec(k)?.[1])
    .filter((y): y is string => !!y)
    .map(Number)
    .sort((a, b) => a - b);
}

const num = (v: string | undefined) => Number(v || 0);

/** all = every line of the CMS file as an object keyed by column name. Pure: no download, no database. */
export function transformMedicare(all: Record<string, string>[]): { rows: OutRow[]; summary: Summary } {
  // The file holds one "Overall" row per drug plus one row per manufacturer. Adding them all would count spend twice.
  const rows = all.filter((r) => r.Mftr_Name === "Overall");
  const years = rows.length ? yearsOf(Object.keys(rows[0])) : [];
  const last = years[years.length - 1];

  const sums = new Map<string, OutRow>();
  const missed: Record<string, number> = {};
  for (const r of rows) {
    const hit = classify(r.Brnd_Name ?? "", r.Gnrc_Name ?? "");
    if (!hit) {
      // Remember look-alike drugs we left out on purpose, so the exclusions are visible.
      if (/glutide|gliptin|gliflozin|insulin|metformin/i.test(r.Gnrc_Name ?? "")) {
        missed[r.Gnrc_Name] = (missed[r.Gnrc_Name] ?? 0) + num(r[`Tot_Spndng_${last}`]);
      }
      continue;
    }
    for (const y of years) {
      const k = `${y}|${hit.drug_class}|${hit.drug}`;
      const s = sums.get(k) ?? { year: y, ...hit, claims: 0, spend: 0 };
      s.claims += num(r[`Tot_Clms_${y}`]);
      s.spend += num(r[`Tot_Spndng_${y}`]);
      sums.set(k, s);
    }
  }

  // A drug that was not on the market yet has zero rows for earlier years; leave those out.
  const out = [...sums.values()]
    .filter((r) => r.spend > 0 || r.claims > 0)
    .sort((a, b) => a.year - b.year || a.drug_class.localeCompare(b.drug_class) || a.drug.localeCompare(b.drug));

  const totals: Summary["totals"] = {};
  for (const r of out) {
    const t = (totals[`${r.year}|${r.drug_class}`] ??= { spend: 0, claims: 0 });
    t.spend += r.spend;
    t.claims += r.claims;
  }
  const share: Summary["share"] = {};
  for (const y of years) {
    const all_y = rows.reduce((a, r) => a + num(r[`Tot_Spndng_${y}`]), 0);
    const mine = out.filter((r) => r.year === y).reduce((a, r) => a + r.spend, 0);
    share[String(y)] = all_y > 0 ? Math.round((mine / all_y) * 1e4) / 100 : 0;
  }
  return {
    rows: out,
    summary: { years, source_rows: all.length, overall_rows: rows.length, output_rows: out.length, totals, share, left_out: missed },
  };
}

const COLS = ["year", "drug_class", "drug", "claims", "spend"] as const;
const esc = (v: unknown) => `"${String(v).replaceAll('"', '""')}"`;
export function toCsv(out: OutRow[]): string {
  return [COLS.join(","), ...out.map((r) => COLS.map((c) => esc(c === "spend" ? r.spend.toFixed(2) : r[c])).join(","))].join("\n") + "\n";
}
