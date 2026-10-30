import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

function rng(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = rng(42);

const clinics = [1, 2];
const depts = [
  { name: "Primary care", base: [60, 45], noShow: 0.08 },
  { name: "Behavioral health", base: [25, 20], noShow: 0.12 },
  { name: "Endocrinology", base: [18, 12], noShow: 0.06 },
];

const start = Date.UTC(2024, 0, 1);
const end = Date.UTC(2026, 9, 28);
const dow = [0, 1.1, 1.02, 1.0, 0.98, 0.9, 0]; // Sun..Sat, weekends closed
const holidays = new Set(["01-01", "07-04", "12-25"]);

const rows = ["date,clinic_id,department,scheduled,completed,no_shows"];
const byDept: Record<string, { s: number; n: number }> = {};
const byYear: Record<string, number> = {};

for (let t = start; t <= end; t += 86400000) {
  const d = new Date(t);
  const wd = d.getUTCDay();
  const iso = d.toISOString().slice(0, 10);
  if (dow[wd] === 0 || holidays.has(iso.slice(5))) continue;
  const years = (t - start) / (365.25 * 86400000);
  const month = d.getUTCMonth();

  for (const clinic of clinics) {
    for (const dept of depts) {
      let n = dept.base[clinic - 1] * dow[wd] * (1 + 0.08 * years);
      if (dept.name === "Primary care" && (month === 11 || month <= 1)) n *= 1.15;
      if (month === 6 || month === 7) n *= 0.92;
      const scheduled = Math.max(0, Math.round(n * (0.92 + 0.16 * rand())));

      let rate = dept.noShow + (wd === 1 ? 0.015 : 0);
      if (dept.name === "Behavioral health") rate += 0.015 * years;
      rate *= 0.8 + 0.4 * rand();
      const noShows = Math.round(scheduled * rate);

      rows.push([iso, clinic, `"${dept.name}"`, scheduled, scheduled - noShows, noShows].join(","));
      byDept[dept.name] ??= { s: 0, n: 0 };
      byDept[dept.name].s += scheduled;
      byDept[dept.name].n += noShows;
      const y = iso.slice(0, 4);
      byYear[y] = (byYear[y] ?? 0) + scheduled;
    }
  }
}

const out = fileURLToPath(new URL("../../data/clinic_daily.csv", import.meta.url));
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, rows.join("\n") + "\n");

console.log("rows:", rows.length - 1);
console.log("scheduled by year:", byYear);
for (const [k, v] of Object.entries(byDept))
  console.log(`no-show rate, ${k}: ${((v.n / v.s) * 100).toFixed(1)}%`);
console.log("written to:", out);