import { useEffect, useState } from "react";
import type { User } from "./api";
import Medicaid from "./Medicaid";
import Payers from "./Payers";
import Catalog from "./Catalog";
import Operations from "./Operations";
import Assistant from "./Assistant";
import Overview from "./Overview";
import Home from "./Home";
import Icon from "./Icon";
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
import Evaluation from "./Evaluation";
import { resolvedTheme, useAppearance, watchSystemTheme } from "./appearance";

type TabId =
  | "home" | "overview" | "medicaid" | "payers" | "operations" | "drugs" | "riskcare" | "riskops" | "riskspend" | "riskcomp"
  | "catalog" | "patients" | "audit" | "settings" | "signals" | "agent" | "entry" | "eval";

type Item = { id: TabId; label: string; icon: string; roles: User["role"][] };
const ALL: User["role"][] = ["admin", "clinician", "executive"];
const TOP: Item[] = [
  { id: "home", label: "Home", icon: "home", roles: ["admin", "clinician", "executive", "nurse"] },
  { id: "agent", label: "Tiffany", icon: "spark", roles: ALL },
  { id: "patients", label: "Patients", icon: "user", roles: ["clinician"] },
  { id: "entry", label: "Add records", icon: "plus", roles: ["nurse"] },
];
const GROUPS: { id: string; label: string; icon: string; items: Omit<Item, "icon">[] }[] = [
  {
    id: "reports",
    label: "Reports",
    icon: "chart",
    items: [
      { id: "overview", label: "Overview", roles: ALL },
      { id: "medicaid", label: "Medicaid", roles: ALL },
      { id: "payers", label: "Medicaid vs Medicare", roles: ALL },
      { id: "operations", label: "Operations", roles: ALL },
      { id: "drugs", label: "Drug classes", roles: ALL },
      { id: "riskcare", label: "Care risk", roles: ALL },
      { id: "riskops", label: "Operational risk", roles: ALL },
      { id: "riskspend", label: "Financial exposure", roles: ALL },
      { id: "riskcomp", label: "Risk & compliance", roles: ["admin", "executive"] },
      { id: "signals", label: "Signals", roles: ["admin", "executive"] },
      { id: "catalog", label: "Data catalog", roles: ALL },
    ],
  },
  {
    id: "admin",
    label: "Admin",
    icon: "shield",
    items: [
      { id: "audit", label: "Audit log", roles: ["admin"] },
      { id: "eval", label: "Agent evaluation", roles: ["admin"] },
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
  home: { title: "Home", lede: "" },
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
    title: "Tiffany's workspace",
    lede: "Give her a task. She works on it, shows what she is doing, and waits for your approval.",
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
    lede: "Every sign-in, page view and question asked of Carey. Only administrators can read this log.",
  },
  eval: {
    title: "Agent evaluation",
    lede: "Adversarial cases run against the agent with the real model. Each check inspects the data the agent was given, so a pass does not depend on the model saying the right words.",
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
  const [tab, setTab] = useState<TabId>("home");
  const [open, setOpen] = useState<boolean>(false);
  const [shut, setShut] = useState<Record<string, boolean>>({ reports: true, admin: true });
  const [tour, setTour] = useState<boolean>(() => user.role !== "nurse" && load(`careboard.tour.${email}`) !== "done");
  const [custom, setCustom] = useState<string>(() => load(NAME_KEY(email)) ?? "");
  const [look, setLook] = useAppearance();
  useEffect(() => watchSystemTheme(), []);
  const dark = resolvedTheme(look.theme) === "dark";

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && mobile()) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const toggleNav = () => setOpen(!open);
  // Open the group that holds the current page, so the active item is always visible (the tour moves between pages too).
  useEffect(() => {
    const g = GROUPS.find((x) => x.items.some((i) => i.id === tab));
    if (g) setShut((c) => (c[g.id] ? { ...c, [g.id]: false } : c));
  }, [tab]);
  const go = (id: TabId) => {
    setTab(id);
    if (mobile()) setOpen(false);
  };
  const closeTour = () => {
    setTour(false);
    setTab("home");
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
  const topItems = TOP.filter((i) => i.roles.includes(user.role));
  const groups = GROUPS.map((g) => ({ ...g, items: g.items.filter((i) => i.roles.includes(user.role)) })).filter(
    (g) => g.items.length
  );
  const crumb = GROUPS.find((g) => g.items.some((i) => i.id === tab))?.label ?? (tab === "agent" ? "AI agent" : null);
  const hour = new Date().getHours();
  const hello = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const title = tab === "home" ? `${hello}, ${shown}` : head.title;
  const eyebrow = tab === "home" ? new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" }) : crumb;
  const link = (i: { id: TabId; label: string; icon?: string }, sub = false) => (
    <button
      key={i.id}
      className={"nav-item" + (sub ? " sub" : "") + (tab === i.id ? " active" : "")}
      data-tour={`nav-${i.id}`}
      aria-current={tab === i.id ? "page" : undefined}
      onClick={() => go(i.id)}
    >
      {i.icon && <Icon name={i.icon} />}
      {i.label}
    </button>
  );
  const initial = (shown || "?").trim().charAt(0).toUpperCase();

  return (
    <div className={"app" + (open ? " nav-open" : "")}>
      <aside className="side" id="side" aria-label="Main navigation">
        <div className="brand">
          <span className="brand-dot" aria-hidden="true" />
          CareBoard
        </div>
        <nav className="side-nav" data-tour="nav">
          {topItems.map((i) => link(i))}
          {groups.map((g) => {
            const isShut = !!shut[g.id];
            return (
              <div className="nav-group" key={g.id}>
                <button
                  className="nav-item nav-group-head"
                  aria-expanded={!isShut}
                  onClick={() => setShut({ ...shut, [g.id]: !isShut })}
                >
                  <Icon name={g.icon} />
                  {g.label}
                  <Chevron open={!isShut} />
                </button>
                {!isShut && g.items.map((i) => link(i, true))}
              </div>
            );
          })}
          {link({ id: "settings", label: "Settings", icon: "sliders" })}
        </nav>
        <div className="side-foot">
          <div className="side-user">
            <span className="side-av" aria-hidden="true">{initial}</span>
            <div className="side-who"><b>{shown}</b><span>{user.role}</span></div>
            <button className="side-out" onClick={onSignOut} aria-label="Sign out" title="Sign out"><Icon name="out" /></button>
          </div>
        </div>
      </aside>
      {open && <div className="scrim" onClick={() => setOpen(false)} />}
      <div className="main">
        <header className="bar">
          <button className="menu" onClick={toggleNav} aria-expanded={open} aria-controls="side" aria-label={open ? "Close navigation" : "Open navigation"}>
            <Icon name="menu" size={18} />
          </button>
          <span className="bar-title">CareBoard</span>
        </header>
        <div className="shell">
          <div className="top">
            <div>
              {eyebrow && <span className="mono">{eyebrow}</span>}
              <h1>{title}</h1>
              {head.lede && tab !== "home" && <p className="lede">{head.lede}</p>}
            </div>
            <button className="theme-btn" onClick={() => setLook({ theme: dark ? "light" : "dark" })} aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}>
              <Icon name={dark ? "sun" : "moon"} />
              {dark ? "Light mode" : "Dark mode"}
            </button>
          </div>
          {tab !== "home" && tab !== "agent" && <p className="role-note"><span className="role-dot" aria-hidden="true" />{ROLE_NOTE[user.role]}</p>}
          <main className={"card" + (tab === "home" || tab === "agent" || tab === "overview" ? " bare" : "")}>
            <ErrorBoundary key={tab}>
            {tab === "home" && <Home role={user.role} onOpen={go} onTour={user.role === "nurse" ? undefined : () => setTour(true)} />}
            {tab === "overview" && <Overview role={user.role} onOpen={go} />}
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
            {tab === "eval" && user.role === "admin" && <Evaluation />}
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
