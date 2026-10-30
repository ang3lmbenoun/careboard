   import { useState } from "react";
   import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
   import { useData } from "./useData";

   type Row = { label: string; prescriptions: number; spend: number };
   type Point = { period: string; prescriptions: number; spend: number };

   const money = (v: number) =>
     v >= 1e9 ? `$${(v / 1e9).toFixed(1)}B` : v >= 1e6 ? `$${(v / 1e6).toFixed(0)}M` : `$${Math.round(v / 1e3)}K`;

   export default function Medicaid() {
     const [cls, setCls] = useState<string | null>(null);
     const [drug, setDrug] = useState<string | null>(null);

     const by = drug ? "state" : cls ? "drug" : "class";
     const filter = new URLSearchParams();
     if (cls) filter.set("class", cls);
     if (drug) filter.set("drug", drug);
     const f = filter.toString();

     const bd = useData<Row[]>(`medicaid/breakdown?by=${by}${f ? "&" + f : ""}`);
     const tr = useData<Point[]>(`medicaid/trend${f ? "?" + f : ""}`);

     const pick = (label: string) => {
       if (!cls) setCls(label);
       else if (!drug) setDrug(label);
     };

     const title =
       by === "class" ? "Spend by drug class" : by === "drug" ? `Spend by drug: ${cls}` : `Top states: ${drug}`;

     return (
       <>
         <p className="crumbs">
           <button onClick={() => { setCls(null); setDrug(null); }} disabled={!cls}>All classes</button>
           {cls && <> › <button onClick={() => setDrug(null)} disabled={!drug}>{cls}</button></>}
           {drug && <> › <strong>{drug}</strong></>}
         </p>

         <h2>{title}</h2>
         {bd.error && <p className="state err">{bd.error}</p>}
         {!bd.data && !bd.error && <p className="state">Loading…</p>}
         {bd.data && (
           <ResponsiveContainer width="100%" height={Math.max(160, bd.data.length * 32)}>
             <BarChart data={bd.data} layout="vertical" margin={{ left: 16, right: 24 }}>
               <CartesianGrid strokeDasharray="3 3" horizontal={false} />
               <XAxis type="number" tickFormatter={money} />
               <YAxis type="category" dataKey="label" width={96} />
               <Tooltip formatter={(v) => money(Number(v))} />
               <Bar
                 dataKey="spend"
                 fill="#1f5c4a" radius={[0, 6, 6, 0]} cursor={by === "state" ? "default" : "pointer"}
                 onClick={(d: any) => pick(d.payload?.label ?? d.label)}
               />
             </BarChart>
           </ResponsiveContainer>
         )}
         {by !== "state" && <p className="note">Click a bar to drill down.</p>}

         <h2>Quarterly spend{cls ? `: ${drug ?? cls}` : ""}</h2>
         {tr.error && <p className="state err">{tr.error}</p>}
         {tr.data && (
           <ResponsiveContainer width="100%" height={240}>
             <LineChart data={tr.data}>
               <CartesianGrid strokeDasharray="3 3" />
               <XAxis dataKey="period" />
               <YAxis tickFormatter={money} />
               <Tooltip formatter={(v) => money(Number(v))} />
               <Line type="monotone" dataKey="spend" stroke="#a8782a" strokeWidth={2.5} />
             </LineChart>
           </ResponsiveContainer>
         )}

         <p className="note">
           Source: CMS Medicaid State Drug Utilization Data, 2024 (quarterly). Scope: four drug classes;
           SGLT2 inhibitors are not included.
         </p>
       </>
     );
   }