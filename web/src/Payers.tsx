import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useData } from "./useData";

type Cls = { label: string; claims: number; spend: number };
type Yr = { year: number; label: string; claims: number; spend: number };

const money = (v: number) =>
  v >= 1e9 ? `$${(v / 1e9).toFixed(1)}B` : v >= 1e6 ? `$${(v / 1e6).toFixed(0)}M` : `$${Math.round(v / 1e3)}K`;
const pct = (v: number) => `${Math.round(v * 100)}%`;
const CLASSES = ["GLP-1", "Insulin", "DPP-4", "Metformin"];
const LINE: Record<string, string> = { "GLP-1": "#1f5c4a", Insulin: "#a8782a", "DPP-4": "#3d7ea6", Metformin: "#9a9aa2" };

// Medicaid and Medicare side by side, for the same four drug classes. The Medicaid numbers are state data for 2024;
// the Medicare numbers are national. Everything shown is added up in the browser from the two tables.
export default function Payers() {
  const mcaid = useData<Cls[]>("medicaid/breakdown?by=class");
  const mcare = useData<Cls[]>("medicare/breakdown?by=class&year=2024");
  const trend = useData<Yr[]>("medicare/trend");

  const err = mcaid.error || mcare.error || trend.error;
  const ready = mcaid.data && mcare.data && trend.data;

  const rows = ready
    ? CLASSES.map((c) => ({
        label: c,
        Medicaid: mcaid.data!.find((r) => r.label === c)?.spend ?? 0,
        Medicare: mcare.data!.find((r) => r.label === c)?.spend ?? 0,
      }))
    : [];
  const totalA = rows.reduce((a, r) => a + r.Medicaid, 0);
  const totalB = rows.reduce((a, r) => a + r.Medicare, 0);

  const years = ready ? [...new Set(trend.data!.map((r) => r.year))].sort() : [];
  const lines = years.map((y) => {
    const o: Record<string, number> = { year: y };
    for (const r of trend.data!.filter((t) => t.year === y)) o[r.label] = r.spend;
    return o;
  });

  // Say so when a class changes sharply between the last two years while the number of claims barely moves.
  const notes: string[] = [];
  if (ready && years.length >= 2) {
    const [a, b] = [years[years.length - 2], years[years.length - 1]];
    for (const c of CLASSES) {
      const x = trend.data!.find((r) => r.year === a && r.label === c);
      const y = trend.data!.find((r) => r.year === b && r.label === c);
      if (!x || !y || !x.spend || !x.claims) continue;
      const ds = y.spend / x.spend - 1;
      const dc = y.claims / x.claims - 1;
      if (Math.abs(ds) >= 0.3 && Math.abs(dc) <= 0.15)
        notes.push(`${c}: spend ${ds < 0 ? "fell" : "rose"} ${pct(Math.abs(ds))} from ${a} to ${b} while prescription fills changed ${dc >= 0 ? "+" : "-"}${pct(Math.abs(dc))}. Cost per fill changed while volume stayed about the same.`);
    }
  }

  return (
    <>
      {err && <p className="state err">{err}</p>}
      {!ready && !err && <p className="state">Loading…</p>}
      {ready && (
        <>
          <p className="story-line">
            Across these four classes, Medicare Part D spent about <strong>{totalA ? (totalB / totalA).toFixed(1) : "?"} times</strong> what
            state Medicaid programs spent in 2024: <strong>{money(totalB)}</strong> against <strong>{money(totalA)}</strong>.
          </p>

          <h2>2024 spend by drug class</h2>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={rows} margin={{ left: 8, right: 16 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="label" />
              <YAxis tickFormatter={money} />
              <Tooltip formatter={(v) => money(Number(v))} />
              <Legend />
              <Bar dataKey="Medicaid" fill="#1f5c4a" radius={[6, 6, 0, 0]} />
              <Bar dataKey="Medicare" fill="#a8782a" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>

          <h2>Medicare Part D spend by class, {years[0]} to {years[years.length - 1]}</h2>
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={lines} margin={{ left: 8, right: 16 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="year" />
              <YAxis tickFormatter={money} />
              <Tooltip formatter={(v) => money(Number(v))} />
              <Legend />
              {CLASSES.map((c) => (
                <Line key={c} type="monotone" dataKey={c} stroke={LINE[c]} strokeWidth={2.5} dot={{ r: 3 }} />
              ))}
            </LineChart>
          </ResponsiveContainer>
          {notes.map((n) => (
            <p key={n} className="note">{n}</p>
          ))}

          <div className="bars-note">
            <strong>Read this before comparing.</strong>
            <ul>
              <li>Medicaid is state data and Medicare is national. Medicare has no state split, so the Medicaid state view stays on its own page.</li>
              <li>Both are amounts paid out before manufacturer rebates, as far as I know. I have not verified this for either source.</li>
              <li>The two sources count differently (Medicaid reimbursements to pharmacies, Medicare Part D plan spending), so treat the ratio as a rough size, not a precise figure.</li>
              <li>SGLT2 inhibitors are left out of both. In Medicare they are a large cost, so these totals understate diabetes drug spending.</li>
              <li>Classes use the same brand-name list for both programs. Drugs not on that list are not counted.</li>
            </ul>
          </div>

          <p className="note">
            Sources: CMS State Drug Utilization Data, 2024 (Medicaid); CMS Medicare Part D Spending by Drug, 2020 to 2024 (Medicare).
          </p>
        </>
      )}
    </>
  );
}
