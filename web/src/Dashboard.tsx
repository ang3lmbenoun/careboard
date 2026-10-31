import { useEffect, useState } from "react";
import type { User } from "./api";
import Medicaid from "./Medicaid";
import Catalog from "./Catalog";
import Operations from "./Operations";
import Assistant from "./Assistant";
import Overview from "./Overview";
import Settings from "./Settings";
import Audit from "./Audit";
import Tour from "./Tour";
import ErrorBoundary from "./ErrorBoundary";
import Patients from "./Patients";
import Drugs from "./Drugs";
import CareRisk from "./CareRisk";
import OpsRisk from "./OpsRisk";
import SpendRisk from "./SpendRisk";
import RiskCompliance from "./RiskCompliance";

type TabId =
  | "overview" | "medicaid" | "operations" | "drugs" | "riskcare" | "riskops" | "riskspend" | "riskcomp"
  | "catalog" | "patients" | "audit" | "settings";

type Item = { id: TabId; label: string; roles: User["role"][] };
const ALL: User["role"][] = ["admin", "clinician", "executive"];
const HOME: Item = { id: "overview", label: "Overview", roles: ALL };
const GROUPS: { id: string; label: string; items: Item[] }[] = [
  {
    id: "analytics",
    label: "Analytics",
    items: [
      { id: "medicaid", label: "Medicaid", roles: ALL },
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
  { id: "reference", label: "Reference", items: [{ id: "catalog", label: "Data catalog", roles: ALL }] },
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

function greeting(): string {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

const HEADINGS: Record<TabId, { title: string; lede: string }> = {
  overview: {
    title: "Overview",
    lede: "Headline numbers from the Medicaid and clinic data. Select a card to open the full view.",
  },
  medicaid: {
    title: "Medicaid drug spend",
    lede: "State Medicaid spending on four diabetes drug classes in 2024. Click a bar to drill from drug class to drug to state.",
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
  const [tab, setTab] = useState<TabId>("overview");
  const [open, setOpen] = useState<boolean>(() => (mobile() ? false : load("careboard.nav") !== "closed"));
  const [shut, setShut] = useState<Record<string, boolean>>({});
  const [tour, setTour] = useState<boolean>(() => load(`careboard.tour.${email}`) !== "done");
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
    tab === "overview"
      ? { title: `${greeting()}, ${shown}`, lede: "Here is what is going on across your Medicaid and clinic data. Select a card to open the full view." }
      : tab === "riskcare" && user.role !== "clinician"
        ? { title: "Care risk", lede: "How many patients fall in each risk group, by clinic and condition. Your role sees counts only, and small groups are hidden by the database. Synthetic patients; illustrative rules." }
        : HEADINGS[tab];
  const groups = GROUPS.map((g) => ({ ...g, items: g.items.filter((i) => i.roles.includes(user.role)) })).filter(
    (g) => g.items.length
  );
  const link = (i: { id: TabId; label: string }) => (
    <button
      key={i.id}
      className={"nav-item" + (tab === i.id ? " active" : "")}
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
        <nav className="side-nav">
          {link(HOME)}
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
          <span className="bar-title">{tab === "overview" ? "Overview" : head.title}</span>
        </header>
        <div className="shell">
          <p className="role-note">{ROLE_NOTE[user.role]}</p>
          <main className="card">
            <div className="page-head">
              <h1>{head.title}</h1>
              <p className="lede">{head.lede}</p>
            </div>
            <ErrorBoundary key={tab}>
            {tab === "overview" && <Overview role={user.role} onOpen={go} />}
            {tab === "medicaid" && <Medicaid />}
            {tab === "operations" && <Operations />}
            {tab === "catalog" && <Catalog role={user.role} />}
            {tab === "patients" && <Patients onOpen={go} />}
            {tab === "drugs" && <Drugs role={user.role} />}
            {tab === "riskcare" && <CareRisk role={user.role} />}
            {tab === "riskops" && <OpsRisk />}
            {tab === "riskspend" && <SpendRisk />}
            {tab === "riskcomp" && <RiskCompliance role={user.role} />}
            {tab === "audit" && <Audit />}
            {tab === "settings" && (
              <Settings onReplayTour={() => setTour(true)} email={email} role={user.role} defaultName={user.name} custom={custom} onSave={saveName} access={ROLE_NOTE[user.role]} />
            )}
            </ErrorBoundary>
          </main>
        </div>
      </div>
      <Assistant />
      {tour && <Tour role={user.role} onClose={closeTour} />}
    </div>
  );
}
