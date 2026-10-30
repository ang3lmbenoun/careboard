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
     if (error) return <p className="state err">{error}</p>;
     if (!data) return <p className="state">Loading…</p>;

     const tables = new Map<string, Col[]>();
     for (const c of data) {
       const key = `${c.schema}.${c.table}`;
       tables.set(key, [...(tables.get(key) ?? []), c]);
     }

     return (
       <>
         
         <p className="note">Lists only the columns your role can read.</p>
         {[...tables.entries()].map(([name, cols]) => (
           <details key={name} className="catalog-item">
             <summary>
               <strong>{name}</strong> ({cols.length} columns)
             </summary>
             <p className="note">{cols[0].table_description ?? "No description."}</p>
             <table className="data">
               <tbody>
                 {cols.map((c) => (
                   <tr key={c.column}>
                     <td><code>{c.column}</code></td>
                     <td>{c.type}</td>
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