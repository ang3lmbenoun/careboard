import { useState } from "react";
import type { User } from "./api";
import Medicaid from "./Medicaid";
import Catalog from "./Catalog";
import Operations from "./Operations";
import Assistant from "./Assistant";
import { useData } from "./useData";

type TabId = "medicaid" | "operations" | "catalog" | "patients" | "audit";

const TABS: { id: TabId; label: string; roles: User["role"][] }[] = [
  { id: "medicaid", label: "Medicaid", roles: ["admin", "clinician", "executive"] },
  { id: "operations", label: "Operations", roles: ["admin", "clinician", "executive"] },
  { id: "catalog", label: "Catalog", roles: ["admin", "clinician", "executive"] },
  { id: "patients", label: "Patients", roles: ["clinician"] },
  { id: "audit", label: "Audit log", roles: ["admin"] },
];

const HEADINGS: Record<TabId, { title: string; lede: string }> = {
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

export default function Dashboard({ user, onSignOut }: { user: User; onSignOut: () => void }) {
  const tabs = TABS.filter((t) => t.roles.includes(user.role));
  const [tab, setTab] = useState<TabId>("medicaid");
  const head = HEADINGS[tab];
  return (
    <>
      <header className="topbar">
        <div className="topbar-in">
          <div className="brand">
            <svg className="brand-mark" viewBox="0 0 24 24" aria-hidden="true">
              <rect width="24" height="24" rx="7" fill="#b8903f" />
              <path d="M12 6v12M6 12h12" stroke="#12352b" strokeWidth="2.4" strokeLinecap="round" />
            </svg>
            CareBoard
          </div>
          <div className="who">
            <span>{user.name}</span>
            <span className="badge">{user.role}</span>
            <button className="ghost" onClick={onSignOut}>Sign out</button>
          </div>
        </div>
      </header>
      <div className="shell">
        <p className="role-note">{ROLE_NOTE[user.role]}</p>
        <nav className="tabs" aria-label="Sections">
          {tabs.map((t) => (
            <button
              key={t.id}
              className={"tab" + (tab === t.id ? " active" : "")}
              aria-current={tab === t.id ? "page" : undefined}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </nav>
        <main className="card">
          <div className="page-head">
            <h1>{head.title}</h1>
            <p className="lede">{head.lede}</p>
          </div>
          {tab === "medicaid" && <Medicaid />}
          {tab === "operations" && <Operations />}
          {tab === "catalog" && <Catalog />}
          {tab === "patients" && <TableView key="patients" path="patients" />}
          {tab === "audit" && <TableView key="audit" path="audit" />}
        </main>
      </div>
      <Assistant />
    </>
  );
}
