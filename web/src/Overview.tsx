import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useData } from "./useData";

type Cls = { label: string; prescriptions: number; spend: number };
type Ops = { period: string; scheduled: number; completed: number; no_shows: number; no_show_rate: number };

const money = (v: number) =>
  v >= 1e9 ? `$${(v / 1e9).toFixed(1)}B` : v >= 1e6 ? `$${(v / 1e6).toFixed(0)}M` : `$${Math.round(v / 1e3)}K`;
const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
const count = (v: number) => Math.round(v).toLocaleString();

function Kpi(props: { label: string; value: string | null; note: string; onOpen: () => void; cta: string }) {
  return (
    <div className="kpi">
      <p className="kpi-label">{props.label}</p>
      <p className="kpi-value">{props.value ?? "…"}</p>
      <p className="kpi-note">{props.note}</p>
      <button className="kpi-link" onClick={props.onOpen}>
        {props.cta} →
      </button>
    </div>
  );
}

type Role = "admin" | "clinician" | "executive";
type Dest = "medicaid" | "operations" | "catalog" | "patients" | "audit" | "riskcare" | "riskspend" | "riskcomp";

const START: Record<Role, { text: string; links: { label: string; to: Dest }[] }> = {
  executive: {
    text: "You see aggregate numbers only. Good places to begin:",
    links: [
      { label: "Which drug classes cost the most", to: "medicaid" },
      { label: "Where appointments are missed", to: "operations" },
      { label: "Where spending is concentrated", to: "riskspend" },
    ],
  },
  clinician: {
    text: "You can see patients of your own clinic, without names. Good places to begin:",
    links: [
      { label: "No-shows by department", to: "operations" },
      { label: "Your clinic's patients", to: "patients" },
      { label: "Patients who need attention first", to: "riskcare" },
    ],
  },
  admin: {
    text: "You can read the audit log, but not patient records. Good places to begin:",
    links: [
      { label: "Review recent activity", to: "audit" },
      { label: "What each role is denied", to: "catalog" },
      { label: "Review the risk register", to: "riskcomp" },
    ],
  },
};

export default function Overview({ role, onOpen }: { role: Role; onOpen: (tab: Dest) => void }) {
  const classes = useData<Cls[]>("medicaid/breakdown?by=class");
  const months = useData<Ops[]>("ops/trend?grain=month&");

  const spend = classes.data?.reduce((a, r) => a + r.spend, 0) ?? null;
  const rx = classes.data?.reduce((a, r) => a + r.prescriptions, 0) ?? null;
  const top = classes.data?.[0];
  const scheduled = months.data?.reduce((a, r) => a + r.scheduled, 0) ?? null;
  const noShows = months.data?.reduce((a, r) => a + r.no_shows, 0) ?? null;

  const start = START[role];
  return (
    <>
      <div className="start">
        <p className="start-title">Start here</p>
        <p className="start-text">{start.text}</p>
        <div className="start-links">
          {start.links.map((l) => (
            <button key={l.label} onClick={() => onOpen(l.to)}>{l.label} →</button>
          ))}
        </div>
      </div>
      <div className="kpis">
        <Kpi
          label="Medicaid spend, 2024"
          value={spend === null ? null : money(spend)}
          note={top && spend ? `${top.label} is the largest class, ${pct(top.spend / spend)} of spend.` : "Four diabetes drug classes, all states."}
          onOpen={() => onOpen("medicaid")}
          cta="Explore drug spend"
        />
        <Kpi
          label="Prescriptions reimbursed"
          value={rx === null ? null : count(rx)}
          note="Small cells may be suppressed in the source, so totals can understate."
          onOpen={() => onOpen("medicaid")}
          cta="See by drug and state"
        />
        <Kpi
          label="Appointments scheduled"
          value={scheduled === null ? null : count(scheduled)}
          note="Synthetic clinic data, both clinics, all dates."
          onOpen={() => onOpen("operations")}
          cta="Explore operations"
        />
        <Kpi
          label="No-show rate"
          value={scheduled && noShows !== null ? pct(noShows / scheduled) : null}
          note="No-shows divided by scheduled appointments. Synthetic data."
          onOpen={() => onOpen("operations")}
          cta="Drill by year, month, week"
        />
      </div>

      <div className="chart-row">
        <div className="mini">
          <h3>Medicaid spend by drug class</h3>
          {classes.error && <p className="state err">{classes.error}</p>}
          {!classes.data && !classes.error && <p className="state">Loading…</p>}
          {classes.data && (
            <ResponsiveContainer width="100%" height={Math.max(180, classes.data.length * 44)}>
              <BarChart data={classes.data} layout="vertical" margin={{ left: 8, right: 16 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                <XAxis type="number" tickFormatter={money} />
                <YAxis type="category" dataKey="label" width={84} />
                <Tooltip formatter={(v) => money(Number(v))} />
                <Bar dataKey="spend" fill="#1f5c4a" radius={[0, 6, 6, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
        <div className="mini">
          <h3>No-show rate by month</h3>
          {months.error && <p className="state err">{months.error}</p>}
          {!months.data && !months.error && <p className="state">Loading…</p>}
          {months.data && (
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={months.data} margin={{ left: 0, right: 16 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="period" tickFormatter={(p) => String(p).slice(0, 7)} minTickGap={28} />
                <YAxis tickFormatter={pct} domain={[0, "auto"]} width={52} />
                <Tooltip formatter={(v) => pct(Number(v))} labelFormatter={(p) => String(p).slice(0, 7)} />
                <Line type="monotone" dataKey="no_show_rate" name="No-show rate" stroke="#a8782a" strokeWidth={2.5} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      <p className="hint">
        Not sure what a number means? Select <strong>Ask Carry</strong> in the corner. Carry can explain any figure on
        this page or look up a new one.
      </p>
      <p className="note">
        Medicaid figures come from public CMS State Drug Utilization Data (2024, four drug classes, SGLT2 not
        included). Clinic operations figures are synthetic.
      </p>
    </>
  );
}
