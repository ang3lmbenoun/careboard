import { useEffect, useState } from "react";
import type { User } from "./api";
import Medicaid from "./Medicaid";
import Catalog from "./Catalog";
import Operations from "./Operations";
import Assistant from "./Assistant";
import Overview from "./Overview";
import Settings from "./Settings";
import { useData } from "./useData";

type TabId = "overview" | "medicaid" | "operations" | "catalog" | "patients" | "audit" | "settings";

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
  catalog: {
    title: "Data catalog",
    lede: "Every table and column your role is allowed to read, with plain-language descriptions.",
  },
  patients: {
    title: "Patients",
    lede: "Synthetic patients from your own clinic. The database hides names and birth dates from your role.",
  },
  audit: {
    title: "Audit log",
    lede: "Actions recorded by the API. Only administrators can read this table.",
  },
  settings: {
    title: "Settings",
    lede: "Your account details and how CareBoard addresses you.",
  },
};

const ROLE_NOTE: Record<User["role"], string> = {
  admin: "Administrator access: aggregate data and the audit log. The database denies patient records to this role.",
  clinician: "Clinician access: patients of your own clinic, without names or birth dates, plus aggregate data.",
  executive: "Executive access: aggregate Medicaid and operations data only.",
};

function TableView({ path }: { path: string }) {
  const { data, error } = useData<Record<string, unknown>[]>(path);
  if (error) return <p className="state err">{error}</p>;
  if (!data) return <p className="state">Loading…</p>;
  if (!data.length) return <p className="state">No rows.</p>;
  const cols = Object.keys(data[0]);
  return (
    <div className="table-wrap">
      <table className="data">
        <thead>
          <tr>{cols.map((c) => <th key={c}>{c}</th>)}</tr>
        </thead>
        <tbody>
          {data.map((r, i) => (
            <tr key={i}>{cols.map((c) => <td key={c}>{String(r[c])}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

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
  const saveName = (v: string) => {
    const name = v.trim().slice(0, 30);
    setCustom(name);
    save(NAME_KEY(email), name || null);
  };

  const shown = custom || user.name;
  const head =
    tab === "overview"
      ? { title: `${greeting()}, ${shown}`, lede: "Here is what is going on across your Medicaid and clinic data. Select a card to open the full view." }
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
            {tab === "overview" && <Overview onOpen={go} />}
            {tab === "medicaid" && <Medicaid />}
            {tab === "operations" && <Operations />}
            {tab === "catalog" && <Catalog />}
            {tab === "patients" && <TableView key="patients" path="patients" />}
            {tab === "audit" && <TableView key="audit" path="audit" />}
            {tab === "settings" && (
              <Settings email={email} role={user.role} defaultName={user.name} custom={custom} onSave={saveName} access={ROLE_NOTE[user.role]} />
            )}
          </main>
        </div>
      </div>
      <Assistant />
    </div>
  );
}
