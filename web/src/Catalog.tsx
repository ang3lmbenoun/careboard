import { useData } from "./useData";
import { METRICS, TABLES, friendlyType } from "./catalogContent";

type Col = {
  schema: string;
  table: string;
  column: string;
  type: string;
  table_description: string | null;
  column_description: string | null;
  allowed: boolean;
  label: string | null;
};

export default function Catalog({ role }: { role: string }) {
  const { data, error } = useData<Col[]>("catalog");
  if (error) return <p className="state err">{error}</p>;
  if (!data) return <p className="state">Loading…</p>;

  const tables = new Map<string, Col[]>();
  for (const c of data) {
    if (c.schema === "app" && role !== "admin") continue;
    const key = `${c.schema}.${c.table}`;
    tables.set(key, [...(tables.get(key) ?? []), c]);
  }

  return (
    <>
      <h2 className="sec">What the numbers mean</h2>
      <div className="metrics">
        {METRICS.map((m) => (
          <div className="metric" key={m.name}>
            <h3>{m.name}</h3>
            <p>{m.meaning}</p>
            <p className="note">{m.note}</p>
          </div>
        ))}
      </div>

      <h2 className="sec">Datasets</h2>
      <p className="note">
        Columns marked <span className="lock-tag">Locked</span> exist in the database but your role is not allowed to read
        them. The database enforces this, not the app.
      </p>
      {[...tables.entries()].map(([name, cols], idx) => {
        const info = TABLES[name];
        const open = cols.filter((c) => c.allowed).length;
        const access =
          open === 0
            ? "No access. The database denies every column to your role."
            : open === cols.length
              ? `Full access to all ${cols.length} columns.`
              : `You can read ${open} of ${cols.length} columns.`;
        return (
          <details key={name} className="catalog-item" open={idx === 0}>
            <summary>
              <strong>{info?.title ?? name}</strong>
              {info && <span className={"src " + info.source}>{info.source === "public" ? "Public data" : "Synthetic"}</span>}
              {open === 0 && <span className="lock-tag">Locked</span>}
            </summary>
            {info && <p className="ds-summary">{info.summary}</p>}
            <dl className="facts compact">
              {info && (
                <>
                  <dt>One row is</dt>
                  <dd>{info.grain.replace(/^One row per /, "a ").replace(/^One row is /, "")}</dd>
                  <dt>Shown on</dt>
                  <dd>{info.usedOn}</dd>
                </>
              )}
              <dt>Your access</dt>
              <dd>{access}</dd>
              <dt>Technical name</dt>
              <dd><code>{name}</code></dd>
            </dl>
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>Column</th>
                    <th>Meaning</th>
                    <th>Type</th>
                    <th>Sensitivity</th>
                  </tr>
                </thead>
                <tbody>
                  {cols.map((c) => (
                    <tr key={c.column} className={c.allowed ? "" : "denied"}>
                      <td><code>{c.column}</code></td>
                      <td>
                        {c.allowed ? (
                          c.column_description ?? ""
                        ) : (
                          <>
                            <span className="lock-tag">Locked</span> Not available to your role.
                          </>
                        )}
                      </td>
                      <td>{friendlyType(c.type)}</td>
                      <td>{c.label ? <span className={"sens " + c.label.toLowerCase().replace(/[^a-z]+/g, "-")}>{c.label}</span> : ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        );
      })}
    </>
  );
}
