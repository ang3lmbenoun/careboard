import { useState } from "react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useData } from "./useData";
import { Pill, Section, Stat, bandTone, num, when, type Tone } from "./riskUi";

type Risk = {
  risk_id: string;
  category: string;
  title: string;
  description: string;
  inherent_likelihood: number;
  inherent_impact: number;
  inherent_score: number;
  inherent_band: string;
  controls: string[];
  control_summary: string;
  residual_likelihood: number;
  residual_impact: number;
  residual_score: number;
  residual_band: string;
  status: "Mitigated" | "Monitoring" | "Accepted" | "Open";
  owner: string;
  next_step: string;
};
type Control = {
  control_id: string;
  name: string;
  safeguard_type: string;
  hipaa_ref: string;
  how_implemented: string;
  status: "Implemented" | "Partial" | "Gap" | "Inherited";
  how_to_verify: string;
};
type Security = {
  totals: Record<string, number>;
  daily: { day: string; sign_ins: number; failed: number; denied: number }[];
  events: { at: string; action: string; role: string | null; detail: { reason?: string; route?: string } | null }[];
  inventory: { dataset: string; row_count: number; latest: string | null }[];
  checks: { area: string; name: string; status: "pass" | "warn" | "fail"; detail: string }[];
  tests: { name: string; status: "pass" | "warn" | "fail"; detail: string }[];
};

const STATUS_TONE: Record<Risk["status"], Tone> = { Mitigated: "ok", Monitoring: "info", Accepted: "muted", Open: "warn" };
const CONTROL_TONE: Record<Control["status"], Tone> = { Implemented: "ok", Partial: "warn", Gap: "fail", Inherited: "info" };
const RESULT_TONE: Record<string, Tone> = { pass: "ok", warn: "warn", fail: "fail" };
const RESULT_WORD: Record<string, string> = { pass: "Pass", warn: "Warning", fail: "Fail" };

function Matrix({ risks }: { risks: Risk[] }) {
  const [view, setView] = useState<"before" | "after">("after");
  const at = (l: number, i: number) =>
    risks.filter((r) => (view === "before" ? r.inherent_likelihood === l && r.inherent_impact === i : r.residual_likelihood === l && r.residual_impact === i));
  const band = (s: number) => (s >= 15 ? "crit" : s >= 10 ? "high" : s >= 5 ? "med" : "low");
  return (
    <>
      <div className="seg" role="group" aria-label="Matrix view">
        <button className={view === "before" ? "on" : ""} onClick={() => setView("before")}>Before controls</button>
        <button className={view === "after" ? "on" : ""} onClick={() => setView("after")}>After controls</button>
      </div>
      <div className="matrix-wrap">
        <div className="matrix-y">Impact</div>
        <div className="matrix-body">
        <div className="matrix-yt">{[5, 4, 3, 2, 1].map((i) => <span key={i}>{i}</span>)}</div>
        <div className="matrix" role="img" aria-label={`Risk matrix ${view} controls`}>
          {[5, 4, 3, 2, 1].map((i) =>
            [1, 2, 3, 4, 5].map((l) => (
              <div key={`${l}-${i}`} className={`mcell m-${band(l * i)}`}>
                {at(l, i).map((r) => (
                  <span key={r.risk_id} className="mid" title={r.title}>{r.risk_id}</span>
                ))}
              </div>
            ))
          )}
        </div>
        <div className="matrix-xt">{[1, 2, 3, 4, 5].map((i) => <span key={i}>{i}</span>)}</div>
        </div>
        <div className="matrix-x">Likelihood</div>
      </div>
      <p className="note">Each square is likelihood times impact, both scored 1 to 5 by the project author. Hover a label for the risk.</p>
    </>
  );
}

function Register({ risks }: { risks: Risk[] }) {
  const [cat, setCat] = useState("All");
  const cats = ["All", ...Array.from(new Set(risks.map((r) => r.category)))];
  const rows = risks.filter((r) => cat === "All" || r.category === cat).sort((a, b) => b.residual_score - a.residual_score || a.risk_id.localeCompare(b.risk_id));
  return (
    <>
      <div className="seg" role="group" aria-label="Filter by category">
        {cats.map((c) => (
          <button key={c} className={cat === c ? "on" : ""} onClick={() => setCat(c)}>{c}</button>
        ))}
      </div>
      <div className="table-wrap">
        <table className="data reg">
          <thead>
            <tr><th>ID</th><th>Risk</th><th>Before</th><th>After</th><th>Status</th><th>Controls</th><th>Next step</th></tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.risk_id}>
                <td><code>{r.risk_id}</code></td>
                <td>
                  <strong>{r.title}</strong>
                  <div className="sub">{r.category}. {r.description}</div>
                  <div className="sub">{r.control_summary}</div>
                </td>
                <td><Pill tone={bandTone(r.inherent_band)}>{r.inherent_score} {r.inherent_band}</Pill></td>
                <td><Pill tone={bandTone(r.residual_band)}>{r.residual_score} {r.residual_band}</Pill></td>
                <td><Pill tone={STATUS_TONE[r.status]}>{r.status}</Pill><div className="sub">Owner: {r.owner}</div></td>
                <td>{r.controls.length ? r.controls.join(", ") : <span className="sub">none</span>}</td>
                <td className="sub-td">{r.next_step}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function ControlMap({ controls }: { controls: Control[] }) {
  const counts = controls.reduce<Record<string, number>>((a, c) => ((a[c.status] = (a[c.status] ?? 0) + 1), a), {});
  return (
    <>
      <p className="note">
        {Object.entries(counts).map(([k, v]) => `${v} ${k.toLowerCase()}`).join(", ")}. Gaps are listed on purpose: they are what a real organization would have to close.
      </p>
      <div className="table-wrap">
        <table className="data reg">
          <thead>
            <tr><th>ID</th><th>Control</th><th>HIPAA Security Rule area</th><th>Status</th><th>How it works</th><th>How to check</th></tr>
          </thead>
          <tbody>
            {controls.map((c) => (
              <tr key={c.control_id}>
                <td><code>{c.control_id}</code></td>
                <td><strong>{c.name}</strong><div className="sub">{c.safeguard_type}</div></td>
                <td className="sub-td">{c.hipaa_ref}</td>
                <td><Pill tone={CONTROL_TONE[c.status]}>{c.status}</Pill></td>
                <td className="sub-td">{c.how_implemented}</td>
                <td className="sub-td">{c.how_to_verify}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function ChecksTable({ rows }: { rows: { key: string; status: string; name: string; detail: string }[] }) {
  return (
    <div className="table-wrap">
      <table className="data checks-t">
        <tbody>
          {rows.map((x) => (
            <tr key={x.key}>
              <td style={{ width: 84 }}><Pill tone={RESULT_TONE[x.status]}>{RESULT_WORD[x.status]}</Pill></td>
              <td><strong>{x.name}</strong></td>
              <td className="sub-td">{x.detail}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Live() {
  const { data, error } = useData<Security>("risk/security");
  if (error) return <p className="state err">{error}</p>;
  if (!data) return <p className="state">Loading security metrics…</p>;
  const t = data.totals;
  const failedTests = data.tests.filter((x) => x.status !== "pass").length;
  const failedChecks = data.checks.filter((x) => x.status === "fail").length;
  const areas = Array.from(new Set(data.checks.map((c) => c.area)));
  return (
    <>
      <Section title="Security activity, last 30 days" lede="Counted live from the audit log. A quiet week is the normal result for a demo with few visitors.">
        <div className="sc-grid">
          <Stat label="Sign-ins" value={num(t.sign_ins)} note={`${t.active_users} distinct accounts`} />
          <Stat label="Failed sign-ins" value={num(t.failed_sign_ins)} note="Wrong password or unknown account" tone={t.failed_sign_ins > 0 ? "warn" : undefined} />
          <Stat label="Denied requests" value={num(t.denied_requests)} note="Blocked by role or database" tone={t.denied_requests > 0 ? "warn" : undefined} />
          <Stat label="Carry questions" value={num(t.carry_questions)} note={`${t.carry_refusals} refused`} />
          <Stat label="Patient data views" value={num(t.patient_data_views)} note="List, profile, class and risk views" />
          <Stat label="Demo patients" value={`+${t.patients_added} / -${t.patients_removed}`} note="Added and removed" />
        </div>
        <div className="mini" style={{ marginTop: 16 }}>
          <h3>Last 14 days</h3>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={data.daily} margin={{ left: -12, right: 8 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="day" tickFormatter={(d: string) => d.slice(5)} />
              <YAxis allowDecimals={false} />
              <Tooltip />
              <Legend />
              <Bar dataKey="sign_ins" name="Sign-ins" fill="#1f5c4a" isAnimationActive={false} />
              <Bar dataKey="failed" name="Failed sign-ins" fill="#b8903f" isAnimationActive={false} />
              <Bar dataKey="denied" name="Denied requests" fill="#9b2c2c" isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        {data.events.length > 0 && (
          <div className="table-wrap" style={{ marginTop: 12 }}>
            <table className="data mini-data">
              <thead><tr><th>When</th><th>Event</th><th>Role</th><th>Detail</th></tr></thead>
              <tbody>
                {data.events.map((e, i) => (
                  <tr key={i}>
                    <td className="nowrap">{when(e.at)}</td>
                    <td>{e.action === "login_failed" ? "Failed sign-in" : "Denied request"}</td>
                    <td style={{ textTransform: "capitalize" }}>{e.role ?? ""}</td>
                    <td className="sub-td">{(e.detail?.reason ?? e.detail?.route ?? "").replace(/_/g, " ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section
        title={`Control tests: ${data.tests.length - failedTests} of ${data.tests.length} pass`}
        lede="Each test asks the database a question right now, for example whether any role can read patient names. If someone changes a permission, a test turns red."
      >
        <ChecksTable rows={data.tests.map((x) => ({ key: x.name, status: x.status, name: x.name, detail: x.detail }))} />
      </Section>

      <Section
        title={`Data health: ${failedChecks === 0 ? "no failures" : `${failedChecks} failing`}`}
        lede="Row counts and reconciliation checks, similar to the tests a data team runs after every load."
      >
        <div className="table-wrap">
          <table className="data mini-data">
            <thead><tr><th>Dataset</th><th className="num">Rows</th><th>Latest</th></tr></thead>
            <tbody>
              {data.inventory.map((r) => (
                <tr key={r.dataset}><td><code>{r.dataset}</code></td><td className="num">{num(r.row_count)}</td><td>{r.latest ?? ""}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
        {areas.map((a) => (
          <div key={a}>
            <h3 className="subhead">{a}</h3>
            <ChecksTable rows={data.checks.filter((c) => c.area === a).map((x) => ({ key: x.name, status: x.status, name: x.name, detail: x.detail }))} />
          </div>
        ))}
      </Section>
    </>
  );
}

export default function RiskCompliance({ role }: { role: string }) {
  const { data, error } = useData<{ risks: Risk[]; controls: Control[] }>("risk/register");
  if (error) return <p className="state err">{error}</p>;
  if (!data) return <p className="state">Loading…</p>;
  const open = data.risks.filter((r) => r.status === "Open").length;
  const high = data.risks.filter((r) => r.residual_score >= 10).length;
  return (
    <>
      <div className="callout">
        <strong>How to read this page.</strong> It follows the usual risk loop: identify the risk, score it, put a control against it, monitor, and report.
        The scores and the HIPAA references are the project author&rsquo;s own, written as a learning exercise. They are not a compliance certification, and the
        references should be checked against the regulation text before anyone relies on them.
      </div>
      <div className="sc-grid" style={{ marginTop: 16 }}>
        <Stat label="Risks tracked" value={String(data.risks.length)} note="Privacy, access, AI, data, business" />
        <Stat label="High after controls" value={String(high)} note="Residual score 10 or more" tone={high > 0 ? "warn" : "ok"} />
        <Stat label="Open items" value={String(open)} note="Known gaps with a next step" tone={open > 0 ? "warn" : "ok"} />
        <Stat label="Controls mapped" value={String(data.controls.length)} note={`${data.controls.filter((c) => c.status === "Implemented").length} fully implemented`} />
      </div>

      {role === "admin" && <Live />}

      <Section title="Risk matrix" lede="Where each risk sits before and after controls.">
        <Matrix risks={data.risks} />
      </Section>
      <Section title="Risk register" lede="Sorted by risk remaining after controls.">
        <Register risks={data.risks} />
      </Section>
      <Section title="Control map" lede="Each control, the HIPAA Security Rule area it supports, and how to check that it works.">
        <ControlMap controls={data.controls} />
      </Section>
    </>
  );
}
