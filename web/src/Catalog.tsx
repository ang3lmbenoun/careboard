   import { useData } from "./useData";

   type Col = {
     schema: string;
     table: string;
     column: string;
     type: string;
     table_description: string | null;
     column_description: string | null;
   };

   export default function Catalog() {
     const { data, error } = useData<Col[]>("catalog");
     if (error) return <p>{error}</p>;
     if (!data) return <p>Loading…</p>;

     const tables = new Map<string, Col[]>();
     for (const c of data) {
       const key = `${c.schema}.${c.table}`;
       tables.set(key, [...(tables.get(key) ?? []), c]);
     }

     return (
       <>
         <h2>Data catalog</h2>
         <p style={{ fontSize: 13 }}>Lists only the columns your role can read.</p>
         {[...tables.entries()].map(([name, cols]) => (
           <details key={name} style={{ margin: "8px 0" }}>
             <summary>
               <strong>{name}</strong> ({cols.length} columns)
             </summary>
             <p style={{ fontSize: 13 }}>{cols[0].table_description ?? "No description."}</p>
             <table>
               <tbody>
                 {cols.map((c) => (
                   <tr key={c.column}>
                     <td style={{ paddingRight: 16 }}><code>{c.column}</code></td>
                     <td style={{ paddingRight: 16 }}>{c.type}</td>
                     <td>{c.column_description ?? ""}</td>
                   </tr>
                 ))}
               </tbody>
             </table>
           </details>
         ))}
       </>
     );
   }