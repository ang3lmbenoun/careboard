   import { useState } from "react";
   import type { User } from "./api";
   import Medicaid from "./Medicaid";
   import Operations from "./Operations";
   import { useData } from "./useData";

   const TABS = [
     { id: "medicaid", label: "Medicaid", roles: ["admin", "clinician", "executive"] },
     { id: "operations", label: "Operations", roles: ["admin", "clinician", "executive"] },
     { id: "patients", label: "Patients", roles: ["clinician"] },
     { id: "audit", label: "Audit log", roles: ["admin"] },
   ];

   function TableView({ path }: { path: string }) {
     const { data, error } = useData<Record<string, unknown>[]>(path);
     if (error) return <p>{error}</p>;
     if (!data) return <p>Loading…</p>;
     if (!data.length) return <p>No rows.</p>;
     const cols = Object.keys(data[0]);
     return (
       <table>
         <thead>
           <tr>{cols.map((c) => <th key={c} style={{ textAlign: "left", paddingRight: 16 }}>{c}</th>)}</tr>
         </thead>
         <tbody>
           {data.map((r, i) => (
             <tr key={i}>{cols.map((c) => <td key={c} style={{ paddingRight: 16 }}>{String(r[c])}</td>)}</tr>
           ))}
         </tbody>
       </table>
     );
   }

   export default function Dashboard({ user, onSignOut }: { user: User; onSignOut: () => void }) {
     const tabs = TABS.filter((t) => t.roles.includes(user.role));
     const [tab, setTab] = useState("medicaid");
     return (
       <div style={{ maxWidth: 760, margin: "2rem auto", padding: "0 16px" }}>
         <header style={{ display: "flex", justifyContent: "space-between" }}>
           <strong>CareBoard</strong>
           <span>
             {user.name} ({user.role}) <button onClick={onSignOut}>Sign out</button>
           </span>
         </header>
         <nav style={{ margin: "12px 0" }}>
           {tabs.map((t) => (
             <button key={t.id} onClick={() => setTab(t.id)} disabled={tab === t.id}>
               {t.label}
             </button>
           ))}
         </nav>
         {tab === "medicaid" && <Medicaid />}
         {tab === "operations" && <Operations />}
         {tab === "patients" && <TableView key="patients" path="patients" />}
         {tab === "audit" && <TableView key="audit" path="audit" />}
       </div>
     );
   }