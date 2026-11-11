import { useEffect, useState } from "react";
import type { User } from "./api";
import Medicaid from "./Medicaid";
import Payers from "./Payers";
import Catalog from "./Catalog";
import Operations from "./Operations";
import Assistant from "./Assistant";
import Overview from "./Overview";
import Settings from "./Settings";
import Audit from "./Audit";
import Tour from "./Tour";
import Signals from "./Signals";
import ErrorBoundary from "./ErrorBoundary";
import Patients from "./Patients";
import Drugs from "./Drugs";
import CareRisk from "./CareRisk";
import OpsRisk from "./OpsRisk";
import SpendRisk from "./SpendRisk";
import RiskCompliance from "./RiskCompliance";
import Agent from "./Agent";
import DataEntry from "./DataEntry";

type TabId =
  | "overview" | "medicaid" | "payers" | "operations" | "drugs" | "riskcare" | "riskops" | "riskspend" | "riskcomp"
  | "catalog" | "patients" | "audit" | "settings" | "signals" | "agent" | "entry";

type Item = { id: TabId; label: string; roles: User["role"][] };
const ALL: User["role"][] = ["admin", "clinician", "executive"];
const HOME: Item = { id: "overview", label: "Overview", roles: ALL };
const GROUPS: { id: string; label: string; items: Item[] }[] = [
  {
    id: "analytics",
    label: "Analytics",
    items: [
      { id: "medicaid", label: "Medicaid", roles: ALL },
      { id: "payers", label: "Medicaid vs Medicare", roles: ALL },
      { id: "operations", label: "Operations", roles: ALL },
      { id: "drugs", label: "Drug classes", roles: ALL },
    ],
  },
  {
    id: "risk",
    label: "Risk",
    items: [
      { id: "riskcare", label: "Care risk", roles: ALL },
      { id: "riskops", label: "Operational risk", roles: ALL },
      { id: "riskspend", label: "Financial exposure", roles: ALL },
      { id: "riskcomp", label: "Risk & compliance", roles: ["admin", "executive"] },
    ],
  },
  {
    id: "agent",
    label: "Agent",
    items: [{ id: "agent", label: "Care agent", roles: ALL }],
  },
  {
    id: "reference",
    label: "Reference",
    items: [
      { id: "signals", label: "Signals", roles: ["admin", "executive"] },
      { id: "catalog", label: "Data catalog", roles: ALL },
    ],
  },
  {
    id: "entry",
    label: "Data entry",
    items: [{ id: "entry", label: "Add patient records", roles: ["nurse"] }],
  },
  {
    id: "restricted",
    label: "Restricted",
    items: [
      { id: "patients", label: "Patients", roles: ["clinician"] },
      { id: "audit", label: "Audit log", roles: ["admin"] },
    ],
  },
];

function load(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function save(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* storage unavailable: the setting just won't persist */
  }
}

const HEADINGS: Record<TabId, { title: string; lede: string }> = {
  entry: {
    title: "Add patient records",
    lede: "Enter a new patient, a medicine or a measurement for your clinic. The database accepts additions only: no names back, no edits, no deletes.",
  },
  overview: {
    title: "Overview",
    lede: "Headline numbers from the Medicaid and clinic data. Select a card to open the full view.",
  },
  medicaid: {
    title: "Medicaid drug spend",
    lede: "State Medicaid spending on four diabetes drug classes in 2024. Click a bar to drill from drug class to drug to state.",
  },
  agent: {
    title: "Care agent",
    lede: "An assistant that runs as your role. It uses fixed tools, every step is logged, and anything it proposes waits for your approval.",
  },
  payers: {
    title: "Medicaid vs Medicare",
    lede: "The same four diabetes drug classes under the two public programs: state Medicaid in 2024 and national Medicare Part D from 2020 to 2024.",
  },
  operations: {
    title: "Clinic operations",
    lede: "Appointments and no-shows across two clinics. Click a bar to drill from year to month, week and day. This data is synthetic.",
  },
  drugs: {
    title: "Drug classes",
    lede: "The four classes of diabetes and weight-management medicines in this app: what each does, what Medicaid spent on it, and how many synthetic patients take it.",
  },
  riskcare: {
    title: "Care risk",
    lede: "Which patients need attention first, and why. A simple, explainable points score on synthetic patients; the rules are illustrative, not clinical guidance.",
  },
  riskops: {
    title: "Operational risk",
    lede: "How much revenue missed appointments put at risk, where it concentrates, and how much is avoidable. Clinic data is synthetic; the visit value is an assumption you set.",
  },
  riskspend: {
    title: "Financial exposure",
    lede: "How concentrated Medicaid drug spend is, whether price or volume moves it, and what a change in one class would do to the total. Scenarios, not forecasts.",
  },
  riskcomp: {
    title: "Risk & compliance",
    lede: "The risks to the data and the business, the controls against them mapped to HIPAA Security Rule areas, and live checks that those controls still hold.",
  },
  signals: {
    title: "Signals",
    lede: "Where every number on the Overview comes from: the source, the calculation, and what to keep in mind before relying on it.",
  },
  catalog: {
    title: "Data catalog",
    lede: "What each number means, where the data comes from, and what your role is allowed to read.",
  },
  patients: {
    title: "Patients",
    lede: "Synthetic patients from your own clinic, with their medicines and measurements over time. The database hides names and birth dates from your role.",
  },
  audit: {
    title: "Audit log",
    lede: "Every sign-in, page view and question asked of Carry. Only administrators can read this log.",
  },
  settings: {
    title: "Settings",
    lede: "Your account details and how CareBoard addresses you.",
  },
};

const ROLE_NOTE: Record<User["role"], string> = {
  admin: "Administrator access: aggregate data, the audit log, and risk and compliance. The database denies patient records to this role.",
  clinician: "Clinician access: patients of your own clinic, without names or birth dates, plus aggregate data.",
  nurse: "Nurse access: add patients, medicines and measurements for your own clinic. You cannot read names back, change entries or see analysis.",
  executive: "Executive access: aggregate Medicaid and operations data, patient counts with small groups hidden, and the risk register.",
};

const NAME_KEY = (email: string) => `careboard.name.${email}`;
const mobile = () => typeof window !== "undefined" && window.matchMedia("(max-width: 860px)").matches;

function Chevron({ open }: { open: boolean }) {
  return (
    <svg className={"chev" + (open ? " open" : "")} viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <path d="M8 10l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function Dashboard({ user, email, onSignOut }: { user: User; email: string; onSignOut: () => void }) {
  const [tab, setTab] = useState<TabId>(user.role === "nurse" ? "entry" : "overview");
  const [open, setOpen] = useState<boolean>(() => (mobile() ? false : load("careboard.nav") !== "closed"));
  const [shut, setShut] = useState<Record<string, boolean>>({});
  const [tour, setTour] = useState<boolean>(() => user.role !== "nurse" && load(`careboard.tour.${email}`) !== "done");
  const [custom, setCustom] = useState<string>(() => load(NAME_KEY(email)) ?? "");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && mobile()) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const toggleNav = () => {
    const next = !open;
    setOpen(next);
    if (!mobile()) save("careboard.nav", next ? "open" : "closed");
  };
  const go = (id: TabId) => {
    setTab(id);
    if (mobile()) setOpen(false);
  };
  const closeTour = () => {
    setTour(false);
    save(`careboard.tour.${email}`, "done");
  };
  const saveName = (v: string) => {
    const name = v.trim().slice(0, 30);
    setCustom(name);
    save(NAME_KEY(email), name || null);
  };

  const shown = custom || user.name;
  const head =
    tab === "riskcare" && user.role !== "clinician"
        ? { title: "Care risk", lede: "How many patients fall in each risk group, by clinic and condition. Your role sees counts only, and small groups are hidden by the database. Synthetic patients; illustrative rules." }
        : HEADINGS[tab];
  const groups = GROUPS.map((g) => ({ ...g, items: g.items.filter((i) => i.roles.includes(user.role)) })).filter(
    (g) => g.items.length
  );
  const crumb = tab === "overview" ? null : GROUPS.find((g) => g.items.some((i) => i.id === tab))?.label ?? null;
  const link = (i: { id: TabId; label: string }) => (
    <button
      key={i.id}
      className={"nav-item" + (tab === i.id ? " active" : "")}
      data-tour={`nav-${i.id}`}
      aria-current={tab === i.id ? "page" : undefined}
      onClick={() => go(i.id)}
    >
      {i.label}
    </button>
  );

  return (
    <div className={"app" + (open ? " nav-open" : "")}>
      <aside className="side" id="side" aria-label="Main navigation">
        <div className="brand">
          <svg className="brand-mark" viewBox="0 0 24 24" aria-hidden="true">
            <rect width="24" height="24" rx="7" fill="#b8903f" />
            <path d="M12 6v12M6 12h12" stroke="#12352b" strokeWidth="2.4" strokeLinecap="round" />
          </svg>
          CareBoard
        </div>
        <nav className="side-nav" data-tour="nav">
          {user.role !== "nurse" && link(HOME)}
          {groups.map((g) => {
            const isShut = !!shut[g.id];
            return (
              <div className="nav-group" key={g.id}>
                <button
                  className="nav-group-head"
                  aria-expanded={!isShut}
                  onClick={() => setShut({ ...shut, [g.id]: !isShut })}
                >
                  {g.label}
                  <Chevron open={!isShut} />
                </button>
                {!isShut && g.items.map(link)}
              </div>
            );
          })}
        </nav>
        <div className="side-foot">
          {link({ id: "settings", label: "Settings" })}
          <div className="side-user">
            <span className="side-name">{shown}</span>
            <span className="badge">{user.role}</span>
          </div>
          <button className="ghost" onClick={onSignOut}>Sign out</button>
        </div>
      </aside>
      {open && <div className="scrim" onClick={() => setOpen(false)} />}
      <div className="main">
        <header className="bar">
          <button className="menu" onClick={toggleNav} aria-expanded={open} aria-controls="side" aria-label={open ? "Close navigation" : "Open navigation"}>
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
              <path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
          <span className="bar-title">
            {crumb && <span className="bar-crumb">{crumb}<span aria-hidden="true"> / </span></span>}
            {tab === "overview" ? "Overview" : head.title}
          </span>
        </header>
        <div className="shell">
          {tab !== "overview" && <p className="role-note"><span className="role-dot" aria-hidden="true" />{ROLE_NOTE[user.role]}</p>}
          <main className={"card" + (tab === "overview" ? " bare" : "")}>
            {tab !== "overview" && (
              <div className="page-head">
                <h1>{head.title}</h1>
                <p className="lede">{head.lede}</p>
              </div>
            )}
            <ErrorBoundary key={tab}>
            {tab === "overview" && <Overview role={user.role} name={shown} onOpen={go} />}
            {tab === "medicaid" && <Medicaid />}
            {tab === "payers" && <Payers />}
            {tab === "agent" && <Agent role={user.role} />}
            {tab === "entry" && user.role === "nurse" && <DataEntry />}
            {tab === "operations" && <Operations />}
            {tab === "catalog" && <Catalog role={user.role} />}
            {tab === "signals" && <Signals role={user.role} onOpen={go} />}
            {tab === "patients" && <Patients onOpen={go} />}
            {tab === "drugs" && <Drugs role={user.role} />}
            {tab === "riskcare" && <CareRisk role={user.role} />}
            {tab === "riskops" && <OpsRisk />}
            {tab === "riskspend" && <SpendRisk />}
            {tab === "riskcomp" && <RiskCompliance role={user.role} />}
            {tab === "audit" && <Audit />}
            {tab === "settings" && (
              <Settings onReplayTour={user.role === "nurse" ? undefined : () => setTour(true)} email={email} role={user.role} defaultName={user.name} custom={custom} onSave={saveName} access={ROLE_NOTE[user.role]} />
            )}
            </ErrorBoundary>
          </main>
        </div>
      </div>
      {user.role !== "nurse" && <Assistant />}
      {tour && <Tour role={user.role} onClose={closeTour} onGo={(t) => setTab(t)} onNav={(o) => mobile() && setOpen(o)} />}
    </div>
  );
}
