// Generates synthetic patients: demographics, medication history and readings.
// Everything here is invented. Used by the seed script (fixed seed) and the demo "Add patient" button.

export type Rand = () => number;

export function seeded(seed: number): Rand {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type Med = {
  drug: string;
  drug_class: "GLP-1" | "Insulin" | "DPP-4" | "Metformin";
  indication: "Type 2 diabetes" | "Prediabetes" | "Weight management";
  started_on: string;
  stopped_on: string | null;
  stop_reason: string | null;
};
export type Reading = { taken_on: string; a1c: number | null; weight_kg: number | null };
export type Patient = {
  full_name: string;
  birth_date: string;
  city: string;
  primary_condition: "Type 2 diabetes" | "Prediabetes" | "Obesity";
  diagnosed_on: string;
  meds: Med[];
  readings: Reading[];
};

const FIRST = ["Ava", "Noah", "Maya", "Liam", "Sofia", "Elijah", "Amara", "Mateo", "Grace", "Isaiah", "Priya", "Caleb", "Nia", "Omar", "Hannah", "Diego", "Zoe", "Samuel", "Lucia", "Andre", "Ruth", "Tariq", "Elena", "Marcus"];
const LAST = ["Ramirez", "Johnson", "Nguyen", "Okafor", "Smith", "Patel", "Brooks", "Hernandez", "Kim", "Thompson", "Diallo", "Walker", "Garcia", "Mensah", "Cooper", "Reyes", "Bailey", "Silva", "Foster", "Adeyemi"];
const CITIES = ["Fort Worth", "Dallas", "Arlington", "Haltom City", "Irving", "Grand Prairie", "Plano", "Denton"];

const day = 86400000;
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
const pick = <T,>(r: Rand, xs: T[]) => xs[Math.floor(r() * xs.length)];
const between = (r: Rand, lo: number, hi: number) => lo + r() * (hi - lo);

// Typical A1C lowering by drug class (percentage points). Invented for the demo, not clinical guidance.
const A1C_EFFECT = { Metformin: 1.0, "DPP-4": 0.6, "GLP-1": 1.4, Insulin: 1.6 } as const;

export function generatePatient(r: Rand, today: number): Patient {
  const roll = r();
  const condition: Patient["primary_condition"] = roll < 0.6 ? "Type 2 diabetes" : roll < 0.85 ? "Obesity" : "Prediabetes";
  const age = Math.round(between(r, 28, 78));
  const birth = iso(today - age * 365.25 * day - Math.floor(r() * 300) * day);
  const yearsSince = condition === "Type 2 diabetes" ? between(r, 1.5, 12) : between(r, 1, 5);
  const diagnosed = today - yearsSince * 365.25 * day;
  const meds: Med[] = [];
  const add = (m: Omit<Med, "stopped_on" | "stop_reason"> & { stopped_on?: number; stop_reason?: string }) =>
    meds.push({ ...m, stopped_on: m.stopped_on ? iso(m.stopped_on) : null, stop_reason: m.stop_reason ?? null });

  if (condition === "Type 2 diabetes") {
    const gotMetformin = r() < 0.92;
    let metStop: number | undefined;
    if (gotMetformin) {
      if (r() < 0.12) metStop = Math.min(today, diagnosed + between(r, 0.5, 4) * 365.25 * day);
      add({ drug: "Metformin", drug_class: "Metformin", indication: "Type 2 diabetes", started_on: iso(diagnosed), stopped_on: metStop, stop_reason: metStop ? "Stomach side effects" : undefined });
    }
    let t = diagnosed + between(r, 0.8, 2.5) * 365.25 * day;
    let dpp: { drug: string; start: number; idx: number } | null = null;
    if (t < today && r() < 0.5) {
      dpp = { drug: pick(r, ["Sitagliptin (Januvia)", "Linagliptin (Tradjenta)"]), start: t, idx: meds.length };
      add({ drug: dpp.drug, drug_class: "DPP-4", indication: "Type 2 diabetes", started_on: iso(t) });
    }
    t += between(r, 1, 3) * 365.25 * day;
    if (t < today && r() < 0.55) {
      if (dpp) {
        meds[dpp.idx].stopped_on = iso(t);
        meds[dpp.idx].stop_reason = "Switched to GLP-1";
      }
      add({ drug: pick(r, ["Semaglutide (Ozempic)", "Dulaglutide (Trulicity)", "Tirzepatide (Mounjaro)"]), drug_class: "GLP-1", indication: "Type 2 diabetes", started_on: iso(t) });
      t += between(r, 1, 3) * 365.25 * day;
    }
    if (t < today && r() < 0.3) {
      add({ drug: pick(r, ["Insulin glargine (Lantus)", "Insulin lispro (Humalog)", "Insulin aspart (Novolog)"]), drug_class: "Insulin", indication: "Type 2 diabetes", started_on: iso(t) });
    }
  } else if (condition === "Obesity") {
    const start = today - between(r, 0.4, 3) * 365.25 * day;
    const stopped = r() < 0.2 ? Math.min(today, start + between(r, 0.3, 1.2) * 365.25 * day) : undefined;
    add({
      drug: pick(r, ["Semaglutide (Wegovy)", "Tirzepatide (Zepbound)", "Liraglutide (Saxenda)"]),
      drug_class: "GLP-1",
      indication: "Weight management",
      started_on: iso(start),
      stopped_on: stopped,
      stop_reason: stopped ? pick(r, ["Cost or coverage", "Reached weight goal"]) : undefined,
    });
  } else {
    add({ drug: "Metformin", drug_class: "Metformin", indication: "Prediabetes", started_on: iso(diagnosed + between(r, 0.1, 0.6) * 365.25 * day) });
  }

  // Readings about every three months for the last two years.
  const baseA1c = condition === "Type 2 diabetes" ? between(r, 8.2, 10.6) : condition === "Prediabetes" ? between(r, 5.8, 6.4) : between(r, 5.3, 5.9);
  const baseWeight = between(r, 68, 128);
  const readings: Reading[] = [];
  const first = Math.max(diagnosed, today - 2 * 365.25 * day);
  for (let t = first; t <= today; t += 91 * day + Math.floor(r() * 12) * day) {
    let effect = 0;
    let weightPct = 0;
    for (const m of meds) {
      const s = new Date(m.started_on).getTime();
      const e = m.stopped_on ? new Date(m.stopped_on).getTime() : Infinity;
      if (t < s) continue;
      const monthsOn = Math.min(((Math.min(t, e) - s) / day) / 30, 12);
      const ramp = Math.min(monthsOn / 4, 1);
      const active = t <= e;
      const share = active ? 1 : Math.max(0, 1 - (t - e) / (180 * day));
      effect += A1C_EFFECT[m.drug_class] * ramp * share * (condition === "Type 2 diabetes" ? 1 : 0.3);
      if (m.drug_class === "GLP-1") weightPct += (m.indication === "Weight management" ? 0.13 : 0.05) * Math.min(monthsOn / 12, 1) * share;
    }
    effect = Math.min(effect, 3.6);
    const a1c = Math.max(5.2, baseA1c - effect + (r() - 0.5) * 0.5);
    const weight = baseWeight * (1 - weightPct) + (r() - 0.5) * 1.6;
    readings.push({ taken_on: iso(t), a1c: Math.round(a1c * 10) / 10, weight_kg: Math.round(weight * 10) / 10 });
  }
  if (!readings.length) readings.push({ taken_on: iso(today), a1c: Math.round(baseA1c * 10) / 10, weight_kg: Math.round(baseWeight * 10) / 10 });

  return {
    full_name: `${pick(r, FIRST)} ${pick(r, LAST)}`,
    birth_date: birth,
    city: pick(r, CITIES),
    primary_condition: condition,
    diagnosed_on: iso(diagnosed),
    meds,
    readings,
  };
}

// Cohort shaping for the seed patients only (never for patients added with the demo button).
// A realistic clinic has some poorly controlled patients, some who stopped coming in, and some whose treatment
// changed. Without them every patient would look healthy and a risk worklist would have nothing to find.
// This uses its own random stream, so the people generated above stay exactly the same.
// Everything here is invented to give the risk rules something to work with; it is not a finding about real patients.
export function shapeCohort(p: Patient, r: Rand, today: number): Patient {
  const t2d = p.primary_condition === "Type 2 diabetes";
  const draws = { lapse: r(), poor: r(), wt: r(), stop: r(), ins: r(), a: r(), b: r(), c: r(), d: r(), e: r() };
  const clampA1c = (v: number) => Math.round(Math.min(v, 11.4) * 10) / 10;

  // 1. Poorly controlled: the last three A1C values climb past 9.
  if (t2d && draws.poor < 0.2) {
    const tail = p.readings.filter((x) => x.a1c != null).slice(-3);
    const base = 8.5 + draws.a * 0.9;
    const step = 0.3 + draws.e * 0.6;
    tail.forEach((x, k) => (x.a1c = clampA1c(base + step * k)));
  }
  // 2. Treatment changes.
  const nowDay = today / day;
  const hasInsulin = p.meds.some((m) => m.drug_class === "Insulin");
  if (t2d && !hasInsulin && draws.ins < 0.12) {
    p.meds.push({
      drug: "Insulin glargine (Lantus)", drug_class: "Insulin", indication: "Type 2 diabetes",
      started_on: iso((nowDay - Math.round(60 + draws.b * 240)) * day), stopped_on: null, stop_reason: null,
    });
  }
  if (draws.stop < 0.14) {
    const g = p.meds.find((m) => m.drug_class === "GLP-1" && !m.stopped_on && new Date(m.started_on).getTime() < today - 300 * day);
    if (g) {
      g.stopped_on = iso((nowDay - Math.round(40 + draws.c * 110)) * day);
      g.stop_reason = "Cost or coverage";
      const last = [...p.readings].reverse().find((x) => x.a1c != null);
      if (last && last.a1c != null && t2d) last.a1c = clampA1c(last.a1c + 0.7);
    }
  }
  // 3. Weight creeping up over the last two readings.
  if (draws.wt < 0.14) {
    const tail = p.readings.filter((x) => x.weight_kg != null).slice(-2);
    const f = [1.035, 1.06];
    tail.forEach((x, k) => (x.weight_kg = Math.round((x.weight_kg as number) * f[k] * 10) / 10));
  }
  // 4. Lost to follow-up: no readings after a cutoff, but keep at least the first one.
  if (draws.lapse < 0.16) {
    const days = t2d ? 215 + Math.round(draws.d * 200) : 380 + Math.round(draws.d * 120);
    const cutoff = iso(today - days * day);
    const kept = p.readings.filter((x) => x.taken_on <= cutoff);
    p.readings = kept.length ? kept : p.readings.slice(0, 1);
  }
  return p;
}
