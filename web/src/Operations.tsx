   import { useState } from "react";
   import { Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
   import { useData } from "./useData";

   type Level = "year" | "month" | "week" | "day";
   type Range = { grain: Level; from: string | null; to: string | null };
   type Point = { period: string; scheduled: number; completed: number; no_shows: number; no_show_rate: number };
   type Row = { label: string; scheduled: number; no_shows: number; no_show_rate: number };

   const DEPTS = ["Primary care", "Behavioral health", "Endocrinology"];
   const NEXT: Record<Level, Level | null> = { year: "month", month: "week", week: "day", day: null };

   const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
   const tick = (g: Level, p: string) => (g === "year" ? p.slice(0, 4) : g === "month" ? p.slice(0, 7) : p.slice(5));

   function addDays(iso: string, n: number) {
     const d = new Date(iso + "T00:00:00Z");
     d.setUTCDate(d.getUTCDate() + n);
     return d.toISOString().slice(0, 10);
   }
   function addMonths(iso: string, n: number) {
     const d = new Date(iso + "T00:00:00Z");
     d.setUTCMonth(d.getUTCMonth() + n);
     return d.toISOString().slice(0, 10);
   }

   function MiniTable({ title, rows, prefix = "" }: { title: string; rows: Row[] | null; prefix?: string }) {
     return (
       <div className="mini">
         <h3>{title}</h3>
         {!rows ? (
           <p className="state">Loading…</p>
         ) : (
           <div className="table-wrap"><table className="data">
             <thead>
               <tr>
                 <th>Name</th>
                 <th className="num">Scheduled</th>
                 <th className="num">No-show</th>
               </tr>
             </thead>
             <tbody>
               {rows.map((r) => (
                 <tr key={r.label}>
                   <td>{prefix}{r.label}</td>
                   <td className="num">{r.scheduled.toLocaleString()}</td>
                   <td className="num">{pct(r.no_show_rate)}</td>
                 </tr>
               ))}
             </tbody>
           </table></div>
         )}
       </div>
     );
   }

   export default function Operations() {
     const [trail, setTrail] = useState<{ label: string; range: Range }[]>([
       { label: "All years", range: { grain: "year", from: null, to: null } },
     ]);
     const [clinic, setClinic] = useState("");
     const [dept, setDept] = useState("");
     const { grain, from, to } = trail[trail.length - 1].range;

     const q = new URLSearchParams();
     if (clinic) q.set("clinic", clinic);
     if (dept) q.set("dept", dept);
     if (from) q.set("from", from);
     if (to) q.set("to", to);

     const trend = useData<Point[]>(`ops/trend?grain=${grain}&${q}`);
     const byDept = useData<Row[]>(`ops/breakdown?by=department&${q}`);
     const byClinic = useData<Row[]>(`ops/breakdown?by=clinic&${q}`);

     function drill(p: string) {
       const next = NEXT[grain];
       if (!next) return;
       let range: Range;
       let label: string;
       if (grain === "year") {
         const y = Number(p.slice(0, 4));
         range = { grain: next, from: `${y}-01-01`, to: `${y + 1}-01-01` };
         label = String(y);
       } else if (grain === "month") {
         range = { grain: next, from: p, to: addMonths(p, 1) };
         label = p.slice(0, 7);
       } else {
         range = { grain: next, from: p, to: addDays(p, 7) };
         label = `Week of ${p}`;
       }
       setTrail([...trail, { label, range }]);
     }

     return (
       <>
         <p className="crumbs">
           {trail.map((t, i) => (
             <span key={i}>
               {i > 0 && " › "}
               <button disabled={i === trail.length - 1} onClick={() => setTrail(trail.slice(0, i + 1))}>
                 {t.label}
               </button>
             </span>
           ))}
         </p>
         <p>
           Clinic{" "}
           <select value={clinic} onChange={(e) => setClinic(e.target.value)}>
             <option value="">All</option>
             <option value="1">Clinic 1</option>
             <option value="2">Clinic 2</option>
           </select>{" "}
           Department{" "}
           <select value={dept} onChange={(e) => setDept(e.target.value)}>
             <option value="">All</option>
             {DEPTS.map((d) => <option key={d} value={d}>{d}</option>)}
           </select>
         </p>

         <h2>Appointments and no-show rate, by {grain}</h2>
         {trend.error && <p className="state err">{trend.error}</p>}
         {!trend.data && !trend.error && <p className="state">Loading…</p>}
         {trend.data && (
           <ResponsiveContainer width="100%" height={300}>
             <ComposedChart data={trend.data}>
               <CartesianGrid strokeDasharray="3 3" />
               <XAxis dataKey="period" tickFormatter={(p) => tick(grain, String(p))} />
               <YAxis yAxisId="l" />
               <YAxis yAxisId="r" orientation="right" tickFormatter={pct} domain={[0, "auto"]} />
               <Tooltip formatter={(v, name) => (name === "No-show rate" ? pct(Number(v)) : String(v))} />
               <Bar
                 yAxisId="l"
                 dataKey="scheduled" fill="#1f5c4a" radius={[6, 6, 0, 0]}
                 name="Scheduled"
                 cursor={NEXT[grain] ? "pointer" : "default"}
                 onClick={(d: any) => drill(d.payload?.period ?? d.period)}
               />
               <Line yAxisId="r" type="monotone" dataKey="no_show_rate" name="No-show rate" stroke="#a8782a" strokeWidth={2.5} dot={false} />
             </ComposedChart>
           </ResponsiveContainer>
         )}
         {NEXT[grain] && <p className="note">Click a bar to drill down: year, month, week, day.</p>}

         <div className="mini-row">
           <MiniTable title="By department" rows={byDept.data} />
           <MiniTable title="By clinic" rows={byClinic.data} prefix="Clinic " />
         </div>

         <p className="note">
           Synthetic data from a seeded generator (api/scripts/generate_clinic_ops.ts). It does not describe real
           patients or visits.
         </p>
       </>
     );
   }