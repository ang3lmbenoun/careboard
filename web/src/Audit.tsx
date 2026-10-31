import { useState } from "react";
import { useData } from "./useData";

type Row = {
  id: number;
  at: string;
  who: string;
  role: string | null;
  action: string;
  detail: { rows?: number; question?: string } | null;
};

const ACTIONS: Record<string, string> = {
  login: "Signed in",
  assistant_query: "Asked Carry a question",
  view_medicaid_breakdown: "Viewed Medicaid spending",
  view_medicaid_trend: "Viewed the Medicaid quarterly trend",
  view_ops_trend: "Viewed the clinic operations trend",
  view_ops_breakdown: "Viewed clinic operations by clinic or department",
  view_patients: "Viewed the patient list",
  view_catalog: "Viewed the data catalog",
  view_audit: "Viewed this audit log",
  view_kpis: "Viewed the early demo indicators",
};

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

function describe(r: Row): string {
  const d = r.detail ?? {};
  if (r.action === "assistant_query" && d.question) return `Question: “${d.question}”`;
  if (r.action === "login") return "";
  if (typeof d.rows === "number") return `${plural(d.rows, "row")} returned`;
  return "";
}

const when = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

export default function Audit() {
  const { data, error } = useData<Row[]>("audit");
  const [tech, setTech] = useState(false);
  if (error) return <p className="state err">{error}</p>;
  if (!data) return <p className="state">Loading…</p>;
  if (!data.length) return <p className="state">No activity recorded yet.</p>;

  return (
    <>
      <p className="note">
        Showing the latest {data.length} actions, newest first. Questions asked of Carry are recorded as typed (first 200 characters).
      </p>
      <label className="toggle">
        <input type="checkbox" checked={tech} onChange={(e) => setTech(e.target.checked)} /> Show technical codes
      </label>
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th>When</th>
              <th>Who</th>
              <th>Role</th>
              <th>What happened</th>
              <th>Details</th>
              {tech && <th>Action code</th>}
            </tr>
          </thead>
          <tbody>
            {data.map((r) => (
              <tr key={r.id}>
                <td className="nowrap">{when(r.at)}</td>
                <td>{r.who}</td>
                <td style={{ textTransform: "capitalize" }}>{r.role ?? ""}</td>
                <td>{ACTIONS[r.action] ?? r.action.replace(/_/g, " ")}</td>
                <td className="detail">{describe(r)}</td>
                {tech && <td><code>{r.action}</code></td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
