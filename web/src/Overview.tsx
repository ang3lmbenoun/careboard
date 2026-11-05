import type { ReactNode } from "react";
import { Area, AreaChart, CartesianGrid, ReferenceDot, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useState } from "react";
import { useData } from "./useData";
import SignalInfo from "./SignalInfo";
import type { SignalId } from "./signalContent";
import { money, num, pct } from "./riskUi";

type Role = "admin" | "clinician" | "executive";
export type Dest =
  | "medicaid" | "operations" | "drugs" | "catalog" | "patients" | "audit"
  | "riskcare" | "riskops" | "riskspend" | "riskcomp" | "signals" | "payers";

type Cls = { label: string; prescriptions: number; spend: number };
type Trend = { period: string; scheduled: number; completed: number; no_shows: number; no_show_rate: number };
type OpsP = {
  as_of: string | null;
  windows: { s12: number; n12: number }[];
  months: { month: string; scheduled: number; no_shows: number }[];
};
type SpendP = { classes: Cls[] };
type Risk = { residual_band: string };
type Control = { status: "Implemented" | "Partial" | "Gap" | "Inherited" };
type Register = { risks: Risk[]; controls: Control[] };
type PatientCover = { payer: "Medicaid" | "Medicare" | "Dual" | "Commercial" };
type Care = { tier: "High" | "Medium" | "Low"; latest_a1c: number | null; demo_created: boolean };
type Security = {
  totals: Record<string, number>;
  checks: { status: string }[];
  tests: { status: string }[];
};

const VISIT_VALUE = 150; // same default the Operational risk page starts with
const TARGET = 0.1;

const CLASS_COLOR: Record<string, string> = {
  "glp-1": "#b8903f",
  insulin: "#2a8f9a",
  "dpp-4": "#6b5b95",
  metformin: "#2a7360",
};
const colorOf = (label: string) => CLASS_COLOR[label.toLowerCase()] ?? "#7a8a83";

function greeting(): string {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

/* ------------------------------------------------------------------ pieces */

type Tone = "neutral" | "ok" | "warn" | "bad";
type Tag = "real" | "synthetic" | "live" | "self";
const TAGS: Record<Tag, string> = { real: "Real data", synthetic: "Synthetic", live: "Live check", self: "My assessment" };

function Spark({ values }: { values: number[] }) {
  if (values.length < 2) return null;
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const span = hi - lo || 1;
  const pts = values.map((v, i) => [(i / (values.length - 1)) * 100, 28 - ((v - lo) / span) * 24]);
  const line = pts.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(" ");
  const last = pts[pts.length - 1];
  return (
    <span className="spark" aria-hidden="true">
      <svg viewBox="0 0 100 32" preserveAspectRatio="none">
        <polygon points={`0,32 ${line} 100,32`} className="spark-fill" />
        <polyline points={line} className="spark-line" vectorEffect="non-scaling-stroke" />
      </svg>
      <i className="spark-dot" style={{ top: `${(last[1] / 32) * 100}%` }} />
    </span>
  );
}

function Shares({ items }: { items: { label: string; share: number }[] }) {
  return (
    <span className="shares" aria-hidden="true">
      {items.map((i) => (
        <i key={i.label} title={`${i.label} ${pct(i.share, 0)}`} style={{ width: `${Math.max(i.share * 100, 1.5)}%`, background: colorOf(i.label) }} />
      ))}
    </span>
  );
}

const Arrow = () => (
  <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
    <path d="M5 12h14M13 6l6 6-6 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

function Signal(props: {
  id?: SignalId;
  onInfo?: (id: SignalId) => void;
  label: string;
  value: string | null;
  sub: ReactNode;
  tag: Tag;
  tone?: Tone;
  spark?: number[];
  shares?: { label: string; share: number }[];
  cta: string;
  onOpen: () => void;
}) {
  return (
    <div className="sig-wrap">
    <button className={`sig sig-${props.tone ?? "neutral"}`} onClick={props.onOpen}>
      <span className="sig-top">
        <span className="sig-label">{props.label}</span>
        <span className={`tag tag-${props.tag}`}>{TAGS[props.tag]}</span>
      </span>
      <span className="sig-value">{props.value ?? <i className="sk sk-v" />}</span>
      {props.spark && <Spark values={props.spark} />}
      {props.shares && <Shares items={props.shares} />}
      <span className="sig-sub">{props.sub}</span>
      <span className="sig-cta">{props.cta} <Arrow /></span>
    </button>
    {props.id && props.onInfo && (
      <button
        type="button"
        className="sig-info"
        data-tour="sig-info"
        aria-label={`Where "${props.label}" comes from`}
        title="Where this comes from"
        onClick={() => props.onInfo!(props.id!)}
      >
        i
      </button>
    )}
    </div>
  );
}

/* ----------------------------------------------------------------- signals */

const hhi = (shares: number[]) => shares.reduce((a, s) => a + (s * 100) ** 2, 0);

function monthlyRates(ops: OpsP | null): number[] {
  if (!ops) return [];
  const by = new Map<string, { s: number; n: number }>();
  for (const m of ops.months) {
    const e = by.get(m.month) ?? { s: 0, n: 0 };
    e.s += m.scheduled;
    e.n += m.no_shows;
    by.set(m.month, e);
  }
  return Array.from(by.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-18)
    .map(([, e]) => (e.s ? e.n / e.s : 0));
}
function twelve(ops: OpsP | null) {
  if (!ops || !ops.windows.length) return null;
  const s = ops.windows.reduce((a, w) => a + w.s12, 0);
  const n = ops.windows.reduce((a, w) => a + w.n12, 0);
  return { s, n, rate: s ? n / s : 0 };
}

function ExecSignals({ onOpen, onInfo }: { onOpen: (d: Dest) => void; onInfo: (id: SignalId) => void }) {
  const spend = useData<SpendP>("risk/spend");
  const ops = useData<OpsP>("risk/ops");
  const reg = useData<Register>("risk/register");
  const mcare = useData<Cls[]>("medicare/breakdown?by=class");

  const classes = spend.data?.classes ?? [];
  const total = classes.reduce((a, c) => a + c.spend, 0);
  const shares = classes.map((c) => ({ label: c.label, share: total ? c.spend / total : 0 }));
  const top = shares[0];
  const h = shares.length ? hhi(shares.map((s) => s.share)) : null;
  const level = h === null ? "" : h >= 5000 ? "Very concentrated" : h >= 3500 ? "Concentrated" : "Moderately spread";
  const t = twelve(ops.data);
  const mcTotal = (mcare.data ?? []).reduce((a, c) => a + c.spend, 0);
  const ratio = total && mcTotal ? mcTotal / total : null;
  const ctl = reg.data?.controls ?? [];
  const inPlace = ctl.filter((c) => c.status === "Implemented" || c.status === "Inherited").length;
  const hi = reg.data?.risks.filter((r) => r.residual_band === "High" || r.residual_band === "Critical").length ?? 0;

  return (
    <>
      <Signal
        id="spend" onInfo={onInfo} label="Medicaid drug spend, 2024"
        value={spend.error ? "n/a" : total ? money(total) : null}
        shares={shares}
        sub={top ? <><strong>{top.label}</strong> is {pct(top.share, 0)} of it. Four drug classes, all states.</> : "Four drug classes, all states."}
        tag="real" cta="Explore drug spend" onOpen={() => onOpen("medicaid")}
      />
      <Signal
        id="payergap" onInfo={onInfo} label="Medicare vs Medicaid drug spend, 2024"
        value={mcare.error ? "n/a" : ratio ? `${ratio.toFixed(1)}×` : null}
        sub={ratio ? <>Medicare Part D spent {money(mcTotal)} on the same four classes, against {money(total)} for Medicaid.</> : ""}
        tag="real" cta="Compare the programs" onOpen={() => onOpen("payers")}
      />
      <Signal
        id="hhi" onInfo={onInfo} label="Spend concentration"
        value={spend.error ? "n/a" : h === null ? null : num(h)}
        tone={h !== null && h >= 3500 ? "warn" : "neutral"}
        sub={h === null ? "" : <><strong>{level}.</strong> Index runs from 2,500 (four equal classes) to 10,000 (one class).</>}
        tag="real" cta="See what moves it" onOpen={() => onOpen("riskspend")}
      />
      <Signal
        id="revenue" onInfo={onInfo} label="Revenue at risk, last 12 months"
        value={ops.error ? "n/a" : t ? money(t.n * VISIT_VALUE) : null}
        tone="warn"
        spark={monthlyRates(ops.data)}
        sub={t ? <>{pct(t.rate)} of {num(t.s)} visits were no-shows, at an assumed ${VISIT_VALUE} a visit.</> : ""}
        tag="synthetic" cta="Test the assumptions" onOpen={() => onOpen("riskops")}
      />
      <Signal
        id="controls" onInfo={onInfo} label="Controls in place"
        value={reg.error ? "n/a" : ctl.length ? `${inPlace} of ${ctl.length}` : null}
        tone={hi ? "warn" : "ok"}
        sub={ctl.length ? <>{hi} {hi === 1 ? "risk still rates" : "risks still rate"} High or Critical after controls. Gaps are listed openly.</> : ""}
        tag="self" cta="Open the register" onOpen={() => onOpen("riskcomp")}
      />
    </>
  );
}

function ClinSignals({ onOpen }: { onOpen: (d: Dest) => void }) {
  const care = useData<Care[]>("risk/care");
  const ops = useData<OpsP>("risk/ops");
  const cover = useData<PatientCover[]>("patients");
  const mc = cover.data?.filter((r) => r.payer === "Medicare" || r.payer === "Dual").length ?? 0;
  const mcaid = cover.data?.filter((r) => r.payer === "Medicaid").length ?? 0;
  const rows = care.data;
  const high = rows?.filter((r) => r.tier === "High").length ?? 0;
  const med = rows?.filter((r) => r.tier === "Medium").length ?? 0;
  const poor = rows?.filter((r) => r.latest_a1c !== null && r.latest_a1c >= 9).length ?? 0;
  const withA1c = rows?.filter((r) => r.latest_a1c !== null).length ?? 0;
  const added = rows?.filter((r) => r.demo_created).length ?? 0;
  const t = twelve(ops.data);

  return (
    <>
      <Signal
        label="Patients in your clinic"
        value={care.error ? "n/a" : rows ? num(rows.length) : null}
        sub={rows ? (added ? <>{added} added in this demo. Names and birth dates are hidden from your role.</> : "Names and birth dates are hidden from your role.") : ""}
        tag="synthetic" cta="Open patients" onOpen={() => onOpen("patients")}
      />
      <Signal
        label="Patients on Medicare"
        value={cover.error ? "n/a" : cover.data ? num(mc) : null}
        sub={cover.data ? <>Includes dual-coverage patients. {num(mcaid)} are on Medicaid only. Filter by coverage on the Patients page.</> : ""}
        tag="synthetic" cta="See who uses what" onOpen={() => onOpen("patients")}
      />
      <Signal
        label="Need attention first"
        value={care.error ? "n/a" : rows ? num(high) : null}
        tone={high ? "bad" : "ok"}
        sub={rows ? <>High risk, plus {med} at medium. Each flag shows its reason.</> : ""}
        tag="synthetic" cta="Open the worklist" onOpen={() => onOpen("riskcare")}
      />
      <Signal
        label="Latest A1C at 9% or higher"
        value={care.error ? "n/a" : rows ? num(poor) : null}
        tone={poor ? "warn" : "ok"}
        sub={rows ? <>Out of {num(withA1c)} patients with a result on file.</> : ""}
        tag="synthetic" cta="See who and why" onOpen={() => onOpen("riskcare")}
      />
      <Signal
        label="No-show rate, last 12 months"
        value={ops.error ? "n/a" : t ? pct(t.rate) : null}
        tone={t && t.rate > TARGET ? "warn" : "ok"}
        spark={monthlyRates(ops.data)}
        sub={t ? <>All clinics. A {pct(TARGET, 0)} target is the working assumption.</> : ""}
        tag="synthetic" cta="Where it concentrates" onOpen={() => onOpen("riskops")}
      />
    </>
  );
}

function AdminSignals({ onOpen, onInfo }: { onOpen: (d: Dest) => void; onInfo: (id: SignalId) => void }) {
  const sec = useData<Security>("risk/security");
  const reg = useData<Register>("risk/register");
  const tests = sec.data?.tests ?? [];
  const checks = sec.data?.checks ?? [];
  const tp = tests.filter((t) => t.status === "pass").length;
  const cp = checks.filter((t) => t.status === "pass").length;
  const failed = sec.data?.totals.failed_sign_ins ?? 0;
  const denied = sec.data?.totals.denied_requests ?? 0;
  const ctl = reg.data?.controls ?? [];
  const gaps = ctl.filter((c) => c.status === "Gap").length;
  const partial = ctl.filter((c) => c.status === "Partial").length;

  return (
    <>
      <Signal
        id="tests" onInfo={onInfo} label="Control tests passing"
        value={sec.error ? "n/a" : tests.length ? `${tp} of ${tests.length}` : null}
        tone={tests.length && tp === tests.length ? "ok" : "bad"}
        sub="Queried from the database each time this page loads, so a changed permission shows up here."
        tag="live" cta="See each test" onOpen={() => onOpen("riskcomp")}
      />
      <Signal
        id="checks" onInfo={onInfo} label="Data health checks"
        value={sec.error ? "n/a" : checks.length ? `${cp} of ${checks.length}` : null}
        tone={checks.length && cp === checks.length ? "ok" : "warn"}
        sub="Row counts, freshness and referential checks on the data."
        tag="live" cta="See the checks" onOpen={() => onOpen("riskcomp")}
      />
      <Signal
        id="refused" onInfo={onInfo} label="Refused, last 30 days"
        value={sec.error ? "n/a" : sec.data ? num(failed + denied) : null}
        sub={sec.data ? <>{num(failed)} failed sign-ins and {num(denied)} blocked requests.</> : ""}
        tag="live" cta="Open the audit log" onOpen={() => onOpen("audit")}
      />
      <Signal
        id="gaps" onInfo={onInfo} label="Known gaps"
        value={reg.error ? "n/a" : ctl.length ? num(gaps + partial) : null}
        tone={gaps ? "warn" : "neutral"}
        sub={ctl.length ? <>{gaps} open and {partial} partial among {ctl.length} controls. Listed on purpose.</> : ""}
        tag="self" cta="Open the control map" onOpen={() => onOpen("riskcomp")}
      />
    </>
  );
}

/* ------------------------------------------------------------------- story */

function Story() {
  const classes = useData<Cls[]>("medicaid/breakdown?by=class");
  const months = useData<Trend[]>("ops/trend?grain=month&");

  const cls = classes.data;
  const total = cls?.reduce((a, c) => a + c.spend, 0) ?? 0;
  const top = cls?.[0];
  const rxTotal = cls?.reduce((a, c) => a + c.prescriptions, 0) ?? 0;
  const busiest = cls && rxTotal ? [...cls].sort((a, b) => b.prescriptions - a.prescriptions)[0] : null;
  const volume = busiest && total ? { label: busiest.label, rx: busiest.prescriptions / rxTotal, spend: busiest.spend / total } : null;

  const m = months.data;
  let sentence = "";
  let last: Trend | undefined;
  if (m && m.length >= 6) {
    const rate = (rows: Trend[]) => {
      const s = rows.reduce((a, r) => a + r.scheduled, 0);
      return s ? rows.reduce((a, r) => a + r.no_shows, 0) / s : 0;
    }
    const yearAgo = m.length >= 15;
    const now = rate(m.slice(-3));
    const then = rate(yearAgo ? m.slice(-15, -12) : m.slice(0, 3));
    const d = (now - then) * 100;
    const vs = yearAgo ? "a year ago" : "the start of the data";
    sentence = `No-shows are running at ${pct(now)}, ${Math.abs(d) < 0.2 ? `about level with ${vs}` : d > 0 ? `up ${d.toFixed(1)} points from ${vs}` : `down ${Math.abs(d).toFixed(1)} points from ${vs}`}.`;
    last = m[m.length - 1];
  }
  const rates = m?.map((r) => r.no_show_rate) ?? [];
  const lo = rates.length ? Math.min(...rates, TARGET) - 0.01 : 0;
  const hi = rates.length ? Math.max(...rates, TARGET) + 0.01 : 0.2;

  return (
    <section className="ov-sec" aria-labelledby="ov-story" data-tour="story">
      <div className="ov-sec-head">
        <h2 id="ov-story">What the data says</h2>
        <p>Two stories behind the numbers above.</p>
      </div>
      <div className="ov-pair">
        <article className="panel">
          <span className="tag tag-real">Real data · CMS 2024</span>
          <h3>{top && total ? `${top.label} drugs are ${pct(top.spend / total, 0)} of what Medicaid spent on these four classes` : "Medicaid spend by drug class"}</h3>
          {classes.error && <p className="state err">{classes.error}</p>}
          {!cls && !classes.error && <div className="sk sk-block" />}
          {cls && (
            <>
            <ul className="bars">
              {cls.map((c) => (
                <li key={c.label}>
                  <span className="bars-name">{c.label}</span>
                  <span className="bars-track"><i style={{ width: `${(c.spend / cls[0].spend) * 100}%`, background: colorOf(c.label) }} /></span>
                  <span className="bars-val">{money(c.spend)} <em>{pct(c.spend / total, 0)}</em></span>
                </li>
              ))}
            </ul>
            {volume && volume.rx > volume.spend * 1.5 && (
              <p className="bars-note">
                <strong>{volume.label}</strong> fills {pct(volume.rx, 0)} of prescriptions but accounts for only {pct(volume.spend, 0)} of spend. Volume and cost are very different stories.
              </p>
            )}
            </>
          )}
        </article>
        <article className="panel">
          <span className="tag tag-synthetic">Synthetic</span>
          <h3>{sentence || "No-show rate by month"}</h3>
          {months.error && <p className="state err">{months.error}</p>}
          {!m && !months.error && <div className="sk sk-block" />}
          {m && m.length > 1 && (
            <ResponsiveContainer width="100%" height={230}>
              <AreaChart data={m} margin={{ left: 0, right: 22, top: 14 }}>
                <defs>
                  <linearGradient id="ovg" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#b8903f" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="#b8903f" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="period" tickFormatter={(p) => String(p).slice(0, 7)} minTickGap={36} />
                <YAxis tickFormatter={(v) => pct(v, 1)} domain={[lo, hi]} width={44} allowDataOverflow />
                <Tooltip formatter={(v) => pct(Number(v))} labelFormatter={(p) => String(p).slice(0, 7)} />
                <ReferenceLine y={TARGET} stroke="#9b2c2c" strokeDasharray="4 4" label={{ value: `${pct(TARGET, 0)} target (assumption)`, fill: "#9b2c2c", fontSize: 11, position: "insideBottomRight" }} />
                <Area type="monotone" dataKey="no_show_rate" name="No-show rate" stroke="#a8782a" strokeWidth={2.5} fill="url(#ovg)" isAnimationActive={false} />
                {last && <ReferenceDot x={last.period} y={last.no_show_rate} r={5} fill="#a8782a" stroke="#fff" strokeWidth={2} />}
              </AreaChart>
            </ResponsiveContainer>
          )}
        </article>
      </div>
    </section>
  );
}

/* ----------------------------------------------------------------- explore */

const EXPLORE: Record<Role, { q: string; a: string; to: Dest }[]> = {
  executive: [
    { q: "Which drug classes cost the most?", a: "Drill from class to drug to state.", to: "medicaid" },
    { q: "How does Medicare compare with Medicaid?", a: "The same four drug classes, side by side, with Medicare back to 2020.", to: "payers" },
    { q: "What does a missed visit cost us?", a: "Move two sliders and watch revenue at risk change.", to: "riskops" },
    { q: "Are the controls holding?", a: "A 16-item risk register mapped to HIPAA areas.", to: "riskcomp" },
  ],
  clinician: [
    { q: "Who needs attention first?", a: "A ranked worklist, with the reason beside every flag.", to: "riskcare" },
    { q: "What is one patient's story?", a: "A1C and weight over time, and every medicine started or stopped.", to: "patients" },
    { q: "Which patients are on Medicare or Medicaid?", a: "Filter patients by coverage and read each one's medicine history.", to: "patients" },
    { q: "Where are visits being missed?", a: "No-show rate by clinic, department and weekday.", to: "operations" },
  ],
  admin: [
    { q: "What happened recently?", a: "Sign-ins, failed sign-ins, denied requests and Carry questions.", to: "audit" },
    { q: "Are the controls still working?", a: "Eight live tests that query the database itself.", to: "riskcomp" },
    { q: "What is each role denied?", a: "The data catalog marks every column your role cannot read.", to: "catalog" },
  ],
};

const LENS: Record<Role, { label: string; can: string[]; cannot: string[] }> = {
  executive: { label: "Executive", can: ["Spend and trends", "Risk register", "Patient counts, small groups hidden"], cannot: ["Patient rows", "Audit log"] },
  clinician: { label: "Clinician", can: ["Your clinic's patients", "Spend and trends"], cannot: ["Other clinics", "Names and birth dates", "Risk register"] },
  admin: { label: "Administrator", can: ["Audit log", "Control tests", "Risk register"], cannot: ["Patient rows", "Password hashes"] },
};

const LEDE: Record<Role, string> = {
  executive: "Where Medicaid and Medicare drug spend sit, what missed appointments cost, and whether the controls hold. All of it is aggregate.",
  clinician: "Which of your patients need attention first, and how the clinic is doing on missed visits.",
  admin: "Whether the controls still work and what has been refused lately. You can read the audit log but never a patient record.",
};

/* -------------------------------------------------------------------- page */

export default function Overview({ role, name, onOpen }: { role: Role; name: string; onOpen: (tab: Dest) => void }) {
  const lens = LENS[role];
  const [info, setInfo] = useState<SignalId | null>(null);
  const canTrace = role !== "clinician";
  const today = new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });

  return (
    <div className="ov">
      <header className="ov-head">
        <p className="ov-eyebrow">{today}</p>
        <h1>{greeting()}, {name}.</h1>
        <p className="ov-lede">{LEDE[role]}</p>
        <div className="lens" aria-label={`What the ${lens.label} role can and cannot open`}>
          <span className="lens-who">Your lens: {lens.label}</span>
          <ul>
            {lens.can.map((t) => <li key={t} className="ok">{t}</li>)}
            {lens.cannot.map((t) => <li key={t} className="no">{t}</li>)}
          </ul>
        </div>
      </header>

      <section className="ov-sec" aria-labelledby="ov-sig">
        <div className="ov-sec-head">
          <h2 id="ov-sig">Signals to watch</h2>
          <p>{canTrace ? "Select a card to open the full view, or i to see where the number comes from." : "Select a card to open the full view."}</p>
        </div>
        <div className="sigs" data-tour="signals">
          {role === "executive" && <ExecSignals onOpen={onOpen} onInfo={setInfo} />}
          {role === "clinician" && <ClinSignals onOpen={onOpen} />}
          {role === "admin" && <AdminSignals onOpen={onOpen} onInfo={setInfo} />}
        </div>
      </section>

      <Story />

      <section className="ov-sec" aria-labelledby="ov-ex">
        <div className="ov-sec-head">
          <h2 id="ov-ex">Questions you can answer here</h2>
        </div>
        <div className="asks">
          {EXPLORE[role].map((e) => (
            <button key={e.q} className="ask" onClick={() => onOpen(e.to)}>
              <span className="ask-q">{e.q}</span>
              <span className="ask-a">{e.a}</span>
              <span className="ask-go"><Arrow /></span>
            </button>
          ))}
        </div>
      </section>

      <footer className="ov-foot">
        <p>
          <span className="tag tag-real">Real data</span> public CMS figures: Medicaid 2024 by state and Medicare Part D 2020 to 2024, four drug classes (SGLT2 not included).{" "}
          <span className="tag tag-synthetic">Synthetic</span> every patient, appointment and risk score.{" "}
          <span className="tag tag-live">Live check</span> queried from the database as you load the page.
        </p>
        <p>Not sure what a number means? Select <strong>Ask Carry</strong> in the corner, or open the Data catalog.</p>
      </footer>
      {info && canTrace && <SignalInfo id={info} onClose={() => setInfo(null)} onOpen={(to) => onOpen(to)} />}
    </div>
  );
}
