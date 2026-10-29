   import { useEffect, useState } from "react";
   import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
   import { api, type User } from "./api";

   type Kpi = { metric: string; period: string; value: number };

   const TABS = [
     { id: "dashboard", label: "Dashboard", roles: ["admin", "clinician", "executive"] },
     { id: "patients", label: "Patients", roles: ["clinician"] },
     { id: "audit", label: "Audit log", roles: ["admin"] },
   ];

   function useData<T>(path: string) {
     const [data, setData] = useState<T | null>(null);
     const [error, setError] = useState("");
     useEffect(() => {
       api<T>(path).then(setData).catch((e) => setError(e.message));
     }, [path]);
     return { data, error };
   }

   function Trend({ data, fmt }: { data: Kpi[]; fmt?: (v: number) => string }) {
     return (
       <ResponsiveContainer width="100%" height={240}>
         <LineChart data={data}>
           <CartesianGrid strokeDasharray="3 3" />
           <XAxis dataKey="period" />
           <YAxis tickFormatter={fmt} domain={["auto", "auto"]} />
           <Tooltip />
           <Line type="monotone" dataKey="value" strokeWidth={2} />
         </LineChart>
       </ResponsiveContainer>
     );
   }

   function Kpis() {
     const { data, error } = useData<Kpi[]>("kpis");
     if (error) return <p>{error}</p>;
     if (!data) return <p>Loading…</p>;
     const by = (m: string) => data.filter((r) => r.metric === m);
     return (
       <>
         <h2>Appointments</h2>
         <Trend data={by("appointments")} />
         <h2>No-show rate</h2>
         <Trend data={by("no_show_rate")} fmt={(v) => `${(v * 100).toFixed(1)}%`} />
       </>
     );
   }

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
     const [tab, setTab] = useState("dashboard");
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
         {tab === "dashboard" && <Kpis />}
         {tab === "patients" && <TableView key="patients" path="patients" />}
         {tab === "audit" && <TableView key="audit" path="audit" />}
       </div>
     );
   }