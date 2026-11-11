import { useState, type FormEvent, type ReactNode } from "react";
import type { User } from "./api";
import { useData } from "./useData";
import { Carey, TiffanyAvatar } from "./Characters";
import Icon from "./Icon";
import { money, num, pct } from "./riskUi";

type Role = User["role"];
export type HomeDest =
  | "agent" | "patients" | "riskcare" | "riskops" | "riskspend" | "riskcomp" | "operations" | "payers"
  | "audit" | "entry" | "messages" | "verify" | "stock" | "overview" | "catalog" | "medicaid" | "eval";

type Care = { tier: "High" | "Medium" | "Low"; latest_a1c: number | null };
type Action = { id: number; status: string; payload: { patient_ids: number[] }; type: string };
type Run = { id: number; question: string; status: string; started_at: string };
type OpsP = { windows: { s12: number; n12: number }[]; months: { month: string; scheduled: number; no_shows: number }[] };
type SpendP = { classes: { label: string; spend: number }[] };
type Register = { controls: { status: string }[] };
type Security = { totals: Record<string, number>; tests: { status: string }[] };
type Settings = { enabled: boolean };

const TARGET = 0.1;


function rate12(ops: OpsP | null) {
  if (!ops || !ops.windows.length) return null;
  const s = ops.windows.reduce((a, w) => a + w.s12, 0);
  const n = ops.windows.reduce((a, w) => a + w.n12, 0);
  return s ? n / s : null;
}
function monthly(ops: OpsP | null): number[] {
  if (!ops) return [];
  return ops.months.slice(-12).map((m) => (m.scheduled ? m.no_shows / m.scheduled : 0));
}

function Spark({ values }: { values: number[] }) {
  if (values.length < 2) return null;
  const lo = Math.min(...values), hi = Math.max(...values), span = hi - lo || 1;
  const d = values.map((v, i) => `${i ? "L" : "M"}${((i / (values.length - 1)) * 120).toFixed(1)} ${(30 - ((v - lo) / span) * 26).toFixed(1)}`).join(" ");
  return (
    <svg className="hm-spark" viewBox="0 0 120 34" preserveAspectRatio="none" role="img" aria-label="Trend over the last 12 months">
      <path d={d} fill="none" stroke="var(--chart-1)" strokeWidth="1.6" />
    </svg>
  );
}

function Goal({ title, value, sub, children, action, onAction, gold, tone }: {
  title: string; value: ReactNode; sub?: ReactNode; children?: ReactNode; action?: string; onAction?: () => void; gold?: boolean; tone?: "bad" | "ok";
}) {
  return (
    <div className="hm-card">
      <h2>{title}</h2>
      <div className={"hm-num" + (tone ? " " + tone : "")}>{value ?? <span className="sk sk-v" />}</div>
      {children}
      {sub && <p className="hm-sub">{sub}</p>}
      {action && <div className="hm-act"><button className={gold ? "hm-btn gold" : "hm-btn pri"} onClick={onAction}>{action}</button></div>}
    </div>
  );
}

function AskCarey({ role, suggestions }: { role: Role; suggestions: string[] }) {
  const [q, setQ] = useState("");
  const send = (text: string) => {
    const t = text.trim();
    if (!t) return;
    window.dispatchEvent(new CustomEvent("careboard:ask", { detail: t }));
    setQ("");
  };
  const submit = (e: FormEvent) => { e.preventDefault(); send(q); };
  return (
    <div className="hm-card hm-carey hm-grid-bg">
      <Carey size={44} wave />
      <div className="hm-carey-t">
        <b>Hi, I'm Carey.</b>
        <p className="hm-sub">
          Ask me about {role === "admin" ? "how the system is being used" : role === "executive" ? "spend, no-shows and risk" : "your clinic's numbers"}.
          {role === "clinician" && " For follow-ups, Tiffany drafts them for you."}
        </p>
        <div className="hm-chips">
          {suggestions.map((s) => <button key={s} type="button" className="hm-chip" onClick={() => send(s)}>{s}</button>)}
        </div>
      </div>
      <form className="hm-ask" onSubmit={submit}>
        <input value={q} onChange={(e) => setQ(e.target.value)} maxLength={400} placeholder="Ask Carey a question" aria-label="Ask Carey" />
        <button className="hm-btn pri" type="submit" disabled={!q.trim()}>Ask</button>
      </form>
    </div>
  );
}

function Recent({ onOpen }: { onOpen: (d: HomeDest) => void }) {
  const runs = useData<Run[]>("agent/runs");
  const list = (runs.data ?? []).slice(0, 4);
  return (
    <div className="hm-card">
      <div className="hm-row"><h2>Recent activity</h2><button className="hm-link" onClick={() => onOpen("agent")}>See all</button></div>
      {runs.data && list.length === 0 && <p className="hm-sub">Nothing yet. Ask Tiffany for something and it shows up here.</p>}
      <ul className="hm-list">
        {list.map((r) => (
          <li key={r.id}>
            <TiffanyAvatar size={28} />
            <div className="hm-grow">{r.question}<div className="hm-sub">{new Date(r.started_at).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</div></div>
            <span className={"hm-pill" + (r.status === "completed" || r.status === "done" ? " ok" : "")}>{r.status === "completed" ? "Done" : r.status}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Help({ onTour, onOpen }: { onTour?: () => void; onOpen: (d: HomeDest) => void }) {
  return (
    <div className="hm-card">
      <h2>Need a hand?</h2>
      <p className="hm-sub" style={{ margin: "2px 0 10px" }}>Replay the quick tour, or see where each number comes from.</p>
      <div className="hm-actions">
        {onTour && <button className="hm-btn" onClick={onTour}>Start the tour</button>}
        <button className="hm-btn" onClick={() => onOpen("catalog")}>Data catalog</button>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- roles */

function Clinician({ onOpen }: { onOpen: (d: HomeDest) => void }) {
  const hs = useData<Summary>("handoff/summary").data;
  const care = useData<Care[]>("risk/care");
  const ops = useData<OpsP>("risk/ops");
  const acts = useData<Action[]>("agent/actions");
  const rows = care.data;
  const high = rows?.filter((r) => r.tier === "High").length ?? 0;
  const med = rows?.filter((r) => r.tier === "Medium").length ?? 0;
  const pending = acts.data?.filter((a) => a.status === "pending").length ?? 0;
  const r = rate12(ops.data);
  return (
    <>
      <div className="hm-label">What needs you today</div>
      <div className="hm-grid">
        <Goal title="Patients to follow up" value={rows ? num(high + med) : null} tone={high ? "bad" : undefined}
          sub={rows ? `${high} high priority, ${med} medium` : ""} action="Open the worklist" onAction={() => onOpen("riskcare")} />
        <Goal title="Waiting for your approval" value={acts.data ? num(pending) : null}
          sub="Call lists Tiffany drafted" action="Review drafts" gold onAction={() => onOpen("agent")} />
        <Goal title="Unread messages" value={hs ? num(hs.unread) : null} tone={hs && hs.unread ? "bad" : undefined}
          sub={hs ? `${hs.unverified} nurse records not yet checked, ${hs.low_stock.length} medicines low` : ""} action="Open Messages" onAction={() => onOpen("messages")} />
        <Goal title="Clinic no-show rate, 12 months" value={ops.error ? "n/a" : r === null ? null : pct(r)}
          sub={r === null ? "" : r > TARGET ? `Above the ${pct(TARGET, 0)} working target` : `Within the ${pct(TARGET, 0)} working target`}>
          <Spark values={monthly(ops.data)} />
        </Goal>
      </div>
    </>
  );
}

function Executive({ onOpen }: { onOpen: (d: HomeDest) => void }) {
  const spend = useData<SpendP>("risk/spend");
  const ops = useData<OpsP>("risk/ops");
  const reg = useData<Register>("risk/register");
  const classes = spend.data?.classes ?? [];
  const total = classes.reduce((a, c) => a + c.spend, 0);
  const top = classes[0];
  const r = rate12(ops.data);
  const ctl = reg.data?.controls ?? [];
  const gaps = ctl.filter((c) => c.status === "Gap" || c.status === "Partial").length;
  return (
    <>
      <div className="hm-label">Where to look this week</div>
      <div className="hm-grid">
        <Goal title="Missed visits, 12 months" value={ops.error ? "n/a" : r === null ? null : pct(r)}
          sub={r === null ? "" : r > TARGET ? `Above the ${pct(TARGET, 0)} working target` : `Within the ${pct(TARGET, 0)} working target`}
          action="See where it concentrates" onAction={() => onOpen("riskops")}>
          <Spark values={monthly(ops.data)} />
        </Goal>
        <Goal title="Medicaid drug spend, 2024" value={spend.error ? "n/a" : total ? money(total) : null}
          sub={top ? `${top.label} is ${pct(top.spend / total, 0)} of it` : ""} action="See what moves it" onAction={() => onOpen("riskspend")} />
        <Goal title="Open control gaps" value={reg.error ? "n/a" : ctl.length ? num(gaps) : null}
          sub={ctl.length ? `Listed on purpose, among ${ctl.length} controls` : ""} action="Open the register" gold onAction={() => onOpen("riskcomp")} />
      </div>
    </>
  );
}

function Admin({ onOpen }: { onOpen: (d: HomeDest) => void }) {
  const sec = useData<Security>("risk/security");
  const cfg = useData<Settings>("agent/settings");
  const tests = sec.data?.tests ?? [];
  const pass = tests.filter((t) => t.status === "pass").length;
  const refused = (sec.data?.totals.failed_sign_ins ?? 0) + (sec.data?.totals.denied_requests ?? 0);
  return (
    <>
      <div className="hm-label">System health</div>
      <div className="hm-grid">
        <Goal title="Control tests passing" value={sec.error ? "n/a" : tests.length ? `${pass} of ${tests.length}` : null}
          tone={tests.length ? (pass === tests.length ? "ok" : "bad") : undefined}
          sub="Checked against the database each time" action="See each test" onAction={() => onOpen("riskcomp")} />
        <Goal title="Refused in the last 30 days" value={sec.error ? "n/a" : sec.data ? num(refused) : null}
          sub="Failed sign-ins and blocked requests" action="Open the audit log" gold onAction={() => onOpen("audit")} />
        <Goal title="Agents" value={cfg.data ? (cfg.data.enabled ? "On" : "Off") : null}
          tone={cfg.data ? (cfg.data.enabled ? "ok" : "bad") : undefined}
          sub="Kill switch, limits and approvals live on Tiffany's page" action="Open Tiffany's page" onAction={() => onOpen("agent")} />
      </div>
    </>
  );
}

type Summary = { unread: number; unverified: number; needs_correction: number; low_stock: { drug: string }[] };

function Nurse({ onOpen }: { onOpen: (d: HomeDest) => void }) {
  const s = useData<Summary>("handoff/summary").data;
  return (
    <>
      <div className="hm-label">What needs you today</div>
      <div className="hm-grid">
        <Goal title="Unread messages" value={s ? num(s.unread) : null} tone={s && s.unread ? "bad" : undefined} sub="From your clinicians" action="Open Messages" onAction={() => onOpen("messages")} />
        <Goal title="Records to verify" value={s ? num(s.unverified + s.needs_correction) : null} sub={s ? `${s.unverified} not checked, ${s.needs_correction} need correction` : ""} action="Verify records" gold onAction={() => onOpen("verify")} />
        <Goal title="Medicine below reorder level" value={s ? num(s.low_stock.length) : null} tone={s && s.low_stock.length ? "bad" : undefined} sub={s && s.low_stock.length ? s.low_stock.slice(0, 3).map((x) => x.drug).join(", ") : "Nothing low right now"} action="Count stock" onAction={() => onOpen("stock")} />
      </div>
      <div className="hm-label">Your work</div>
      <div className="hm-grid">
        <Goal title="Add a patient record" value={<Icon name="plus" size={22} />} sub="A new patient, a medicine or a measurement for your clinic."
          action="Start" onAction={() => onOpen("entry")} />
        <Goal title="What you can and cannot do" value={<Icon name="shield" size={22} />}
          sub="You add records only. The database does not let your role read names back, change entries or delete them." />
      </div>
    </>
  );
}

const SUGGEST: Record<Role, string[]> = {
  clinician: ["What does no-show rate mean?", "Which department has the highest no-show rate?"],
  executive: ["Which drug class had the most Medicaid spend?", "How many appointments were scheduled each year?"],
  admin: ["What does no-show rate mean?", "Which drug class had the most Medicaid spend?"],
  nurse: [],
};

export default function Home({ role, onOpen, onTour }: { role: Role; onOpen: (d: HomeDest) => void; onTour?: () => void }) {
  return (
    <div className="hm">
      {role !== "nurse" && <AskCarey role={role} suggestions={SUGGEST[role]} />}
      {role === "clinician" && <Clinician onOpen={onOpen} />}
      {role === "executive" && <Executive onOpen={onOpen} />}
      {role === "admin" && <Admin onOpen={onOpen} />}
      {role === "nurse" && <Nurse onOpen={onOpen} />}
      {role !== "nurse" && (
        <div className="hm-cols">
          <Recent onOpen={onOpen} />
          <Help onTour={onTour} onOpen={onOpen} />
        </div>
      )}
    </div>
  );
}
