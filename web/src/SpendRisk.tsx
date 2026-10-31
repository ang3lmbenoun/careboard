import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useData } from "./useData";
import { Pill, Section, Slider, Stat, money, num, pct } from "./riskUi";

type Payload = {
  classes: { label: string; prescriptions: number; spend: number }[];
  quarters: { year: number; quarter: number; drug_class: string; prescriptions: number; spend: number }[];
  drugs: { label: string; drug_class: string; prescriptions: number; spend: number }[];
  states: { label: string; spend: number }[];
};

const hhi = (shares: number[]) => shares.reduce((a, s) => a + (s * 100) ** 2, 0);

export default function SpendRisk() {
  const { data, error } = useData<Payload>("risk/spend");
  const [picked, setPicked] = useState<string | null>(null);
  const [shift, setShift] = useState(10);

  const calc = useMemo(() => {
    if (!data || !data.classes.length) return null;
    const total = data.classes.reduce((a, c) => a + c.spend, 0);
    const rx = data.classes.reduce((a, c) => a + c.prescriptions, 0);
    const classes = data.classes.map((c) => ({ ...c, share: c.spend / total, perRx: c.prescriptions ? c.spend / c.prescriptions : 0 }));
    const stTotal = data.states.reduce((a, s) => a + s.spend, 0);
    const states = data.states.map((s) => ({ ...s, share: s.spend / stTotal }));
    const drugTotal = data.drugs.reduce((a, d) => a + d.spend, 0);
    // Price versus volume between the first and last quarter loaded, per class.
    const keys = Array.from(new Set(data.quarters.map((q) => `${q.year}-${q.quarter}`))).sort();
    const first = keys[0], last = keys[keys.length - 1];
    const pv = classes.map((c) => {
      const a = data.quarters.find((q) => `${q.year}-${q.quarter}` === first && q.drug_class === c.label);
      const b = data.quarters.find((q) => `${q.year}-${q.quarter}` === last && q.drug_class === c.label);
      if (!a || !b || !a.prescriptions || !b.prescriptions) return { label: c.label, delta: null as number | null, volume: 0, price: 0 };
      const p0 = a.spend / a.prescriptions, p1 = b.spend / b.prescriptions;
      return { label: c.label, delta: b.spend - a.spend, volume: (b.prescriptions - a.prescriptions) * p0, price: b.prescriptions * (p1 - p0) };
    });
    return {
      total, rx, classes, states, first, last, pv,
      hhi: hhi(classes.map((c) => c.share)),
      stateHhi: hhi(states.map((s) => s.share)),
      top3States: states.slice(0, 3).reduce((a, s) => a + s.share, 0),
      topDrug: data.drugs[0], topDrugShare: data.drugs[0] ? data.drugs[0].spend / total : 0, drugTotal,
    };
  }, [data]);

  if (error) return <p className="state err">{error}</p>;
  if (!data || !calc) return <p className="state">Loading…</p>;

  const sel = calc.classes.find((c) => c.label === picked) ?? calc.classes[0];
  const delta = sel.spend * (shift / 100);
  const effective = 10000 / calc.hhi;
  const level = calc.hhi >= 5000 ? "very concentrated" : calc.hhi >= 3500 ? "concentrated" : "moderately spread";
  const q = (k: string) => k.replace("-", " Q");

  return (
    <>
      <div className="callout">
        <strong>The business question.</strong> If most of the spend sits in one place, a change there moves the whole total. This page measures that concentration, separates price from volume,
        and lets you test a scenario. It covers four quarters of 2024 Medicaid data, so the scenarios below are <strong>what-ifs, not forecasts</strong>. Spend is the amount reimbursed to pharmacies; as far as I know the source does not net out manufacturer rebates.
      </div>

      <div className="sc-grid" style={{ marginTop: 16 }}>
        <Stat label="Total spend, 2024" value={money(calc.total)} note={`${num(calc.rx)} prescriptions`} />
        <Stat label="Largest class share" value={pct(calc.classes[0].share)} note={calc.classes[0].label} tone="warn" />
        <Stat label="Concentration index (HHI)" value={num(calc.hhi)} note={`${level}. Equal to ${effective.toFixed(1)} equal-sized classes. Range 2,500 to 10,000 with four classes.`} />
        <Stat label="Top three states" value={pct(calc.top3States)} note={`${calc.states.slice(0, 3).map((s) => s.label).join(", ")}`} />
      </div>

      <div className="chart-row">
        <div className="mini">
          <h3>Share of spend by drug class</h3>
          <ResponsiveContainer width="100%" height={Math.max(180, calc.classes.length * 48)}>
            <BarChart data={calc.classes.map((c) => ({ ...c, pct: Math.round(c.share * 1000) / 10 }))} layout="vertical" margin={{ left: 8, right: 24 }}>
              <CartesianGrid strokeDasharray="3 3" horizontal={false} />
              <XAxis type="number" unit="%" domain={[0, 100]} />
              <YAxis type="category" dataKey="label" width={84} />
              <Tooltip formatter={(v) => `${v}%`} />
              <Bar dataKey="pct" name="Share of spend" radius={[0, 6, 6, 0]} isAnimationActive={false}>
                {calc.classes.map((c, i) => <Cell key={c.label} fill={i === 0 ? "#b8903f" : "#1f5c4a"} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="mini">
          <h3>Top states by share of spend</h3>
          <ResponsiveContainer width="100%" height={Math.max(180, Math.min(calc.states.length, 6) * 40)}>
            <BarChart data={calc.states.slice(0, 6).map((s) => ({ ...s, pct: Math.round(s.share * 1000) / 10 }))} layout="vertical" margin={{ left: 8, right: 24 }}>
              <CartesianGrid strokeDasharray="3 3" horizontal={false} />
              <XAxis type="number" unit="%" />
              <YAxis type="category" dataKey="label" width={40} />
              <Tooltip formatter={(v) => `${v}%`} />
              <Bar dataKey="pct" name="Share of spend" fill="#1f5c4a" radius={[0, 6, 6, 0]} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
          <p className="note">State concentration index: {num(calc.stateHhi)} across {calc.states.length} states.</p>
        </div>
      </div>

      <Section title="Price or volume?" lede={`Change in spend from ${q(calc.first)} to ${q(calc.last)}, split into more prescriptions (volume) and a higher or lower cost per prescription (price).`}>
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr><th>Class</th><th className="num">Spend</th><th className="num">Per prescription</th><th className="num">Change in spend</th><th className="num">From volume</th><th className="num">From price</th><th>Driver</th></tr>
            </thead>
            <tbody>
              {calc.classes.map((c) => {
                const p = calc.pv.find((x) => x.label === c.label)!;
                const driver = p.delta === null ? "n/a" : Math.abs(p.volume) >= Math.abs(p.price) ? "Volume" : "Price";
                return (
                  <tr key={c.label}>
                    <td>{c.label}</td>
                    <td className="num">{money(c.spend)}</td>
                    <td className="num">${c.perRx.toFixed(0)}</td>
                    <td className="num">{p.delta === null ? "n/a" : money(p.delta)}</td>
                    <td className="num">{p.delta === null ? "" : money(p.volume)}</td>
                    <td className="num">{p.delta === null ? "" : money(p.price)}</td>
                    <td>{p.delta === null ? "" : <Pill tone={driver === "Volume" ? "info" : "warn"}>{driver}</Pill>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="note">With one year of data this shows what moved within 2024, not a long-run trend.</p>
      </Section>

      <Section title="What if spend in one class changes?" lede="Pick a class and move the slider. The total moves by the class's share of spend.">
        <div className="seg" role="group" aria-label="Drug class">
          {calc.classes.map((c) => (
            <button key={c.label} className={c.label === sel.label ? "on" : ""} onClick={() => setPicked(c.label)}>{c.label}</button>
          ))}
        </div>
        <div className="controls">
          <Slider label={`Change in ${sel.label} spend`} value={shift} min={-30} max={30} step={1} onChange={setShift} format={(v) => `${v > 0 ? "+" : ""}${v}%`} hint="A scenario, not a prediction." />
        </div>
        <div className="sc-grid">
          <Stat label="Effect on total spend" value={`${delta >= 0 ? "+" : "-"}${money(Math.abs(delta))}`} note={`${delta >= 0 ? "+" : "-"}${pct(Math.abs(delta) / calc.total)} of the ${money(calc.total)} total`} tone={Math.abs(delta) / calc.total > 0.05 ? "warn" : undefined} />
          <Stat label="New total" value={money(calc.total + delta)} note={`${sel.label} would be ${money(sel.spend + delta)}`} />
          <Stat label="Sensitivity" value={pct(sel.share)} note={`Each 1% move in ${sel.label} moves the total by about ${sel.share.toFixed(2)}%`} />
        </div>
      </Section>

      <div className="hint">
        <strong>Reading it.</strong> {calc.classes[0].label} makes up {pct(calc.classes[0].share)} of spend, and the leading single drug ({calc.topDrug?.label}) is {pct(calc.topDrugShare)} on its own.
        A coverage or price change in that class matters far more than the same change in a small one. This is the exposure to put in front of whoever sets the budget.
      </div>
    </>
  );
}
