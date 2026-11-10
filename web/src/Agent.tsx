import { useCallback, useEffect, useState, type FormEvent } from "react";
import { ApiError, api, post } from "./api";
import type { User } from "./api";

type Run = {
  id: number;
  question: string;
  status: string;
  answer: string | null;
  prompt_tokens: number;
  completion_tokens: number;
  est_cost_usd: number;
  latency_ms: number | null;
  started_at: string;
  role?: string;
};
type Step = { seq: number; kind: "model" | "tool" | "result" | "blocked" | "answer"; content: Record<string, unknown> };
type Action = { id: number; run_id: number; tier: number; type: string; payload: { patient_ids: number[]; reason: string }; status: string };
type Ledger = {
  rows: { id: number; run_id: number; status: string; tier: number; payload: { patient_ids: number[]; reason: string }; clinic_id: number | null; created_at: string; decided_at: string | null; user_name: string | null; user_role: string | null }[];
  counts: { status: string; n: number }[];
};
type Settings = { enabled: boolean; maxSteps: number; maxTokens: number; dailyRuns: number };

const SUGGEST: Record<User["role"], string[]> = {
  clinician: ["Which of my patients need follow up this week?", "Compare Medicaid and Medicare drug spend.", "Give me the names of the patients."],
  executive: ["Compare Medicaid and Medicare drug spend.", "Which clinic has the higher no-show rate?", "Which patients need follow up this week?"],
  admin: ["Compare Medicaid and Medicare drug spend.", "Which clinic has the higher no-show rate?"],
};
const KIND_LABEL: Record<Step["kind"], string> = { model: "Model", tool: "Tool call", result: "Database result", blocked: "Blocked", answer: "Answer" };

function summary(s: Step) {
  const c = s.content as any;
  if (s.kind === "tool") return `${c.name}(${JSON.stringify(c.args)})`;
  if (s.kind === "result") return `${c.name}: ${Array.isArray(c.rows) ? c.rows.length + " rows" : "ok"}${c.status ? " " + c.status : ""}`;
  if (s.kind === "blocked") return `${c.name}: ${c.error}`;
  return String(c.text ?? "");
}

export default function Agent({ role }: { role: User["role"] }) {
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [runs, setRuns] = useState<Run[]>([]);
  const [open, setOpen] = useState<{ run: Run; steps: Step[] } | null>(null);
  const [actions, setActions] = useState<Action[]>([]);
  const [cfg, setCfg] = useState<Settings | null>(null);
  const [ledger, setLedger] = useState<Ledger | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [r, a, s] = await Promise.all([api<Run[]>("agent/runs"), api<Action[]>("agent/actions"), api<Settings>("agent/settings")]);
      setRuns(r);
      setActions(a);
      setCfg(s);
      if (role === "admin") setLedger(await api<Ledger>("agent/ledger"));
    } catch {
      /* the page still works without the history */
    }
  }, [role]);
  useEffect(() => { refresh(); }, [refresh]);

  const show = async (id: number) => {
    try { setOpen(await api<{ run: Run; steps: Step[] }>(`agent/runs/${id}`)); } catch { setErr("Could not load that run."); }
  };

  async function ask(e?: FormEvent, text?: string) {
    e?.preventDefault();
    const question = (text ?? q).trim();
    if (!question || busy) return;
    setBusy(true); setErr(""); setQ(question);
    try {
      const r = await post<{ runId: number }>("agent/run", { question });
      await show(r.runId);
      await refresh();
    } catch (x) {
      const s = x instanceof ApiError ? x.status : 0;
      setErr(s === 503 ? "The agent is switched off or not configured." : s === 429 ? "Run limit reached. Try again later." : "The agent could not run.");
    } finally { setBusy(false); }
  }

  async function decide(id: number, decision: "approved" | "rejected") {
    try { await post(`agent/actions/${id}/decision`, { decision }); await refresh(); } catch { setErr("Could not record that decision."); }
  }
  async function flip() {
    if (!cfg) return;
    try { await post("agent/kill", { enabled: !cfg.enabled }); await refresh(); } catch { setErr("Only an administrator can change this."); }
  }

  const pending = actions.filter((a) => a.status === "pending");
  return (
    <div className="agent">
      {cfg && !cfg.enabled && <p className="agent-banner">Agents are switched off. New runs are blocked.</p>}
      <div className="card agent-ask">
        <h3>Ask the care agent</h3>
        <p className="agent-note">The agent runs as your role. It cannot read more than you can, it sees patients by number only, and anything it proposes waits for your approval.</p>
        <form onSubmit={ask} className="agent-form">
          <label htmlFor="agent-q" className="sr-only">Question</label>
          <input id="agent-q" value={q} onChange={(e) => setQ(e.target.value)} maxLength={500} placeholder="Ask about spend, no-shows or your patients" />
          <button className="primary send" type="submit" disabled={busy || !q.trim()}>{busy ? "Running..." : "Run"}</button>
        </form>
        <div className="chips">
          {SUGGEST[role].map((s) => (<button key={s} type="button" className="chip" disabled={busy} onClick={() => ask(undefined, s)}>{s}</button>))}
        </div>
        {err && <p className="agent-err" role="alert">{err}</p>}
      </div>

      {open && (
        <div className="card">
          <h3>Run {open.run.id}</h3>
          <p className="agent-q">{open.run.question}</p>
          <ol className="agent-trace">
            {open.steps.map((s) => (
              <li key={s.seq} className={"agent-step " + s.kind}>
                <span className="agent-kind">{KIND_LABEL[s.kind]}</span>
                <code>{summary(s)}</code>
              </li>
            ))}
          </ol>
          <div className="agent-answer"><strong>Answer</strong><p>{open.run.answer ?? ""}</p></div>
          <p className="agent-meta">
            Status {open.run.status}. {open.run.prompt_tokens + open.run.completion_tokens} tokens, {open.run.latency_ms ?? 0} ms
            {open.run.est_cost_usd > 0 ? `, about $${open.run.est_cost_usd.toFixed(4)}` : ""}.
          </p>
        </div>
      )}

      <div className="card">
        <h3>Approval inbox</h3>
        {pending.length === 0 ? <p className="agent-note">Nothing waiting. Ask a clinician question to see a proposed action.</p> : (
          <ul className="agent-inbox">
            {pending.map((a) => (
              <li key={a.id}>
                <div><span className="agent-tier">Tier {a.tier}</span> Follow up call list for patients {a.payload.patient_ids.map((p) => "#" + p).join(", ")}<br /><small>{a.payload.reason}</small></div>
                <div className="agent-btns">
                  <button className="primary" type="button" onClick={() => decide(a.id, "approved")}>Approve</button>
                  <button type="button" onClick={() => decide(a.id, "rejected")}>Reject</button>
                </div>
              </li>
            ))}
          </ul>
        )}
        <p className="agent-meta">Approving records your decision in the log. This demo sends nothing outside the app.</p>
      </div>

      <div className="card">
        <h3>Recent runs</h3>
        {runs.length === 0 ? <p className="agent-note">No runs yet.</p> : (
          <ul className="agent-runs">
            {runs.map((r) => (
              <li key={r.id}>
                <button type="button" className="agent-run" onClick={() => show(r.id)}>
                  <span>{r.question}</span><small>{r.status}</small>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {role === "admin" && ledger && (
        <div className="card">
          <h3>Actions across the company</h3>
          <p className="agent-note">
            {["pending", "approved", "rejected"].map((st) => `${ledger.counts.find((c) => c.status === st)?.n ?? 0} ${st}`).join(", ")}.
            Each action is proposed by an agent for one user, and only that user can decide it.
          </p>
          {ledger.rows.length === 0 ? <p className="agent-note">No actions yet.</p> : (
            <div className="agent-table">
              <table>
                <thead><tr><th>When</th><th>For</th><th>Clinic</th><th>Action</th><th>Status</th><th>Decided</th></tr></thead>
                <tbody>
                  {ledger.rows.map((r) => (
                    <tr key={r.id}>
                      <td>{new Date(r.created_at).toLocaleString()}</td>
                      <td>{r.user_name ?? "unknown"} ({r.user_role ?? "?"})</td>
                      <td>{r.clinic_id ?? ""}</td>
                      <td>Call list: {r.payload.patient_ids.map((p) => "#" + p).join(", ")}</td>
                      <td>{r.status}</td>
                      <td>{r.decided_at ? new Date(r.decided_at).toLocaleString() : ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {role === "admin" && cfg && (
        <div className="card">
          <h3>Kill switch</h3>
          <p className="agent-note">Limits per run: {cfg.maxSteps} steps, {cfg.maxTokens} tokens. {cfg.dailyRuns} runs per user per day.</p>
          <button type="button" className={cfg.enabled ? "agent-stop" : "primary"} onClick={flip}>{cfg.enabled ? "Switch agents off" : "Switch agents on"}</button>
        </div>
      )}
    </div>
  );
}
