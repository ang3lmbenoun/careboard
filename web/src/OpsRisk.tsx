import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useData } from "./useData";
import { Pill, Section, Slider, Stat, money, num, pct, pp, type Tone } from "./riskUi";

type W = {
  clinic_id: number; department: string;
  s12: number; n12: number; sp12: number; np12: number;
  s90: number; n90: number; sp90: number; np90: number;
};
type Payload = {
  as_of: string | null;
  windows: W[];
  weekdays: { dow: number; department: string; scheduled: number; no_shows: number }[];
  months: { month: string; department: string; scheduled: number; no_shows: number }[];
};

const DEPT_COLOR: Record<string, string> = { "Primary care": "#1f5c4a", "Behavioral health": "#b8903f", Endocrinology: "#4a7fb0" };
const DAYS = ["", "Mon", "Tue", "Wed", "Thu", "Fri"];
const rate = (n: number, s: number) => (s > 0 ? n / s : 0);

export default function OpsRisk() {
  const { data, error } = useData<Payload>("risk/ops");
  const [value, setValue] = useState(150);
  const [target, setTarget] = useState(0.1);

  const calc = useMemo(() => {
    if (!data) return null;
    const rows = data.windows.map((w) => {
      const r12 = rate(w.n12, w.s12);
      const rp = rate(w.np12, w.sp12);
      const r90 = rate(w.n90, w.s90);
      const rprev90 = rate(w.np90, w.sp90);
      return {
        ...w, r12, yoy: w.sp12 ? r12 - rp : null, r90, d90: w.sp90 ? r90 - rprev90 : null,
        atRisk: w.n12 * value, avoidable: Math.max(0, w.n12 - target * w.s12) * value,
      };
    });
    const s = rows.reduce((a, r) => a + r.s12, 0);
    const n = rows.reduce((a, r) => a + r.n12, 0);
    const avoid = rows.reduce((a, r) => a + r.avoidable, 0);
    const worst = [...rows].sort((a, b) => b.avoidable - a.avoidable)[0];
    const depts = Array.from(new Set(data.months.map((m) => m.department)));
    const byMonth = new Map<string, Record<string, number | string>>();
    for (const m of data.months) {
      const row = byMonth.get(m.month) ?? { month: m.month };
      row[m.department] = Math.round(rate(m.no_shows, m.scheduled) * 1000) / 10;
      byMonth.set(m.month, row);
    }
    const dow = [1, 2, 3, 4, 5].map((d) => {
      const x = data.weekdays.filter((w) => w.dow === d);
      return { day: DAYS[d], rate: Math.round(rate(x.reduce((a, w) => a + w.no_shows, 0), x.reduce((a, w) => a + w.scheduled, 0)) * 1000) / 10 };
    });
    return { rows, s, n, atRisk: n * value, avoid, worst, depts, trend: Array.from(byMonth.values()), dow };
  }, [data, value, target]);

  if (error) return <p className="state err">{error}</p>;
  if (!data || !calc) return <p className="state">Loading…</p>;
  if (!data.windows.length) return <p className="state">No clinic data loaded.</p>;

  const bestDow = [...calc.dow].sort((a, b) => b.rate - a.rate)[0];
  const trendTone = (d: number | null): Tone => (d === null ? "muted" : d >= 0.01 ? "high" : d <= -0.01 ? "ok" : "muted");
  const trendWord = (d: number | null) => (d === null ? "n/a" : d >= 0.01 ? "Rising" : d <= -0.01 ? "Improving" : "Steady");

  return (
    <>
      <div className="callout">
        <strong>The business question.</strong> Every missed appointment is a slot that cannot be refilled. This page puts a dollar figure on that, shows where it concentrates,
        and shows how much is avoidable if the rate came down to a target. Clinic data is <strong>synthetic</strong>, and the dollar figures depend on the visit value you choose below, which is an assumption.
      </div>

      <div className="controls">
        <Slider label="Average value of one visit" value={value} min={50} max={400} step={10} onChange={setValue} format={(v) => `$${v}`} hint="Assumption. A real figure would come from billing." />
        <Slider label="Target no-show rate" value={target} min={0.04} max={0.15} step={0.005} onChange={setTarget} format={(v) => pct(v)} hint="Assumption. Avoidable loss counts only no-shows above this." />
      </div>

      <div className="sc-grid">
        <Stat label="No-shows, last 12 months" value={num(calc.n)} note={`${pct(rate(calc.n, calc.s))} of ${num(calc.s)} scheduled. Data to ${data.as_of}.`} />
        <Stat label="Revenue at risk" value={money(calc.atRisk)} note={`${num(calc.n)} no-shows at $${value}`} tone="warn" />
        <Stat label="Avoidable above target" value={money(calc.avoid)} note={`If every group came down to ${pct(target)}`} />
        <Stat label="Biggest opportunity" value={calc.worst ? `${calc.worst.department}` : "–"} note={calc.worst ? `Clinic ${calc.worst.clinic_id}: ${money(calc.worst.avoidable)} avoidable` : ""} />
      </div>

      <Section title="Where it concentrates" lede="Last 12 months. The trend column compares the last 90 days with the 90 days before.">
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Clinic</th><th>Department</th><th className="num">Scheduled</th><th className="num">No-show rate</th>
                <th className="num">vs year before</th><th>Last 90 days</th><th className="num">Revenue at risk</th><th className="num">Avoidable</th>
              </tr>
            </thead>
            <tbody>
              {[...calc.rows].sort((a, b) => b.avoidable - a.avoidable).map((r) => (
                <tr key={`${r.clinic_id}-${r.department}`}>
                  <td>Clinic {r.clinic_id}</td>
                  <td>{r.department}</td>
                  <td className="num">{num(r.s12)}</td>
                  <td className="num">{pct(r.r12)} {r.r12 > target && <Pill tone="warn">above target</Pill>}</td>
                  <td className="num">{r.yoy === null ? "n/a" : pp(r.yoy)}</td>
                  <td><Pill tone={trendTone(r.d90)}>{trendWord(r.d90)}</Pill> <span className="sub">{r.d90 === null ? "" : pp(r.d90)}</span></td>
                  <td className="num">{money(r.atRisk)}</td>
                  <td className="num">{money(r.avoidable)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <div className="chart-row">
        <div className="mini">
          <h3>No-show rate by month, by department</h3>
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={calc.trend} margin={{ left: -8, right: 12 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="month" tickFormatter={(m: string) => m.slice(2)} minTickGap={24} />
              <YAxis unit="%" domain={[0, "auto"]} />
              <Tooltip formatter={(v) => `${v}%`} />
              <Legend />
              <ReferenceLine y={target * 100} stroke="#9b2c2c" strokeDasharray="4 4" label={{ value: "target", fill: "#9b2c2c", fontSize: 11, position: "insideTopRight" }} />
              {calc.depts.map((d) => (
                <Line key={d} type="monotone" dataKey={d} stroke={DEPT_COLOR[d] ?? "#666"} strokeWidth={2} dot={false} isAnimationActive={false} />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
        <div className="mini">
          <h3>No-show rate by weekday</h3>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={calc.dow} margin={{ left: -8, right: 12 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="day" />
              <YAxis unit="%" domain={[0, "auto"]} />
              <Tooltip formatter={(v) => `${v}%`} />
              <Bar dataKey="rate" name="No-show rate" fill="#1f5c4a" radius={[6, 6, 0, 0]} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="hint">
        <strong>Reading it.</strong> {bestDow.day} has the highest no-show rate ({bestDow.rate}%). {calc.worst && `${calc.worst.department} at Clinic ${calc.worst.clinic_id} holds the most avoidable revenue at this target.`}{" "}
        Any pattern here, such as one department drifting upward, was built into the synthetic data to give the analysis something to find. With real data this page would test whether reminders or scheduling changes actually move the rate.
      </div>
    </>
  );
}
