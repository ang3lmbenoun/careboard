import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { ApiError, api, post } from "./api";
import type { User } from "./api";
import { TiffanyStage, type Pose } from "./Characters";

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
type Payload = { patient_ids?: number[]; reason?: string; to_name?: string; patient_id?: number | null; subject?: string; body?: string };
type Action = { id: number; run_id: number; tier: number; type: string; payload: Payload; status: string; outcome?: string | null };
const isMsg = (a: { type: string }) => a.type === "handoff_message";
const ids = (a: Action) => a.payload.patient_ids ?? [];
type EmailRes = { status: string; reason?: string; to?: string[] };
const isMail = (a: { type: string }) => a.type === "email_followup_list";
const mailNote = (e?: EmailRes) =>
  !e ? "" : e.status === "sent" ? "Email sent. Check your inbox." : e.status === "dry_run" ? "Saved as a dry run: no email provider key is set on this server, so nothing was sent." : e.status === "skipped" ? "That list was already emailed." : `Not sent: ${e.reason ?? e.status}.`;
type Ledger = {
  rows: { id: number; run_id: number; status: string; tier: number; payload: { patient_ids: number[]; reason: string }; clinic_id: number | null; created_at: string; decided_at: string | null; user_name: string | null; user_role: string | null }[];
  counts: { status: string; n: number }[];
};
type DigestInfo = { log: { id: number; at: string; recipient: string; status: string; reason: string | null; narrative: string | null }[]; recipients: { email: string; enabled: boolean }[] };
type Settings = { enabled: boolean; maxSteps: number; maxTokens: number; dailyRuns: number };

const SUGGEST: Record<User["role"], string[]> = {
  clinician: ["Which of my patients need follow up this week?", "Email me the follow-up list for my highest risk patients.", "Compare Medicaid and Medicare drug spend."],
  executive: ["Compare Medicaid and Medicare drug spend.", "Which clinic has the higher no-show rate?", "Which patients need follow up this week?"],
  admin: ["Compare Medicaid and Medicare drug spend.", "Which clinic has the higher no-show rate?"],
  nurse: ["What do I have to do today?", "Draft a message to the clinician about low stock.", "Draft a message about records that need correction."],
};
const KIND_LABEL: Record<Step["kind"], string> = { model: "Model", tool: "Tool call", result: "Database result", blocked: "Blocked", answer: "Answer" };

function summary(s: Step) {
  const c = s.content as any;
  if (s.kind === "tool") return `${c.name}(${JSON.stringify(c.args)})`;
  if (s.kind === "result") {
    if (Array.isArray(c.passages)) return `${c.name}: ${c.passages.length} passages (${[...new Set(c.passages.map((p: any) => p.title))].join("; ")})`;
    return `${c.name}: ${Array.isArray(c.rows) ? c.rows.length + " rows" : "ok"}${c.status ? " " + c.status : ""}`;
  }
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
  const [dg, setDg] = useState<DigestInfo | null>(null);
  const [preview, setPreview] = useState("");
  const [dgMsg, setDgMsg] = useState("");
  const [dgBusy, setDgBusy] = useState(false);
  const [pose, setPose] = useState<Pose>("calm");
  const [asked, setAsked] = useState("");
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const refresh = useCallback(async () => {
    try {
      const [r, a, s] = await Promise.all([api<Run[]>("agent/runs"), api<Action[]>("agent/actions"), api<Settings>("agent/settings")]);
      setRuns(r);
      setActions(a);
      setCfg(s);
      if (role === "admin") {
        setLedger(await api<Ledger>("agent/ledger"));
        setDg(await api<DigestInfo>("digest/log"));
      }
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
    setBusy(true); setErr(""); setQ(""); setAsked(question); setOpen(null);
    window.clearTimeout(timer.current);
    setPose("thinking");
    try {
      const r = await post<{ runId: number }>("agent/run", { question });
      await show(r.runId);
      await refresh();
      setPose("speaking");
      timer.current = window.setTimeout(() => setPose("calm"), 7000);
    } catch (x) {
      const s = x instanceof ApiError ? x.status : 0;
      setErr(s === 503 ? "The agent is switched off or not configured." : s === 429 ? "Run limit reached. Try again later." : "The agent could not run.");
      setPose("calm");
    } finally { setBusy(false); }
  }

  const [note, setNote] = useState("");
  const [edits, setEdits] = useState<Record<number, { subject: string; body: string }>>({});
  async function decide(id: number, decision: "approved" | "rejected") {
    setNote("");
    try {
      const r = await post<{ ok: boolean; email?: EmailRes; message_id?: number }>(`agent/actions/${id}/decision`, { decision, edit: decision === "approved" ? edits[id] : undefined });
      if (r.email) setNote(mailNote(r.email));
      if (r.message_id) setNote("Message sent to the clinician. They will see it in Messages.");
      await refresh();
    } catch { setErr("Could not record that decision."); }
  }
  async function emailIt(id: number) {
    setNote("");
    try { setNote(mailNote((await post<{ email: EmailRes }>(`agent/actions/${id}/email`, {})).email)); await refresh(); } catch { setErr("Could not send the email."); }
  }
  async function previewDigest() {
    setDgBusy(true); setDgMsg(""); setPreview("");
    try { setPreview((await post<{ text: string }>("digest/preview", {})).text); } catch { setDgMsg("Could not build the preview."); }
    finally { setDgBusy(false); }
  }
  async function sendDigestNow() {
    setDgBusy(true); setDgMsg("");
    try {
      const r = await post<{ results: { recipient: string; status: string; reason?: string }[]; live: boolean }>("digest/send", {});
      setDgMsg(r.results.length === 0 ? "No address is on the allow list." : r.results.map((x) => `${x.recipient}: ${x.status}${x.reason ? " (" + x.reason + ")" : ""}`).join(". ") + (r.live ? "" : " No email provider key is set, so nothing was sent."));
      await refresh();
    } catch { setDgMsg("Could not send."); }
    finally { setDgBusy(false); }
  }
  async function flip() {
    if (!cfg) return;
    try { await post("agent/kill", { enabled: !cfg.enabled }); await refresh(); } catch { setErr("Only an administrator can change this."); }
  }

  const pending = actions.filter((a) => a.status === "pending");
  const approved = actions.filter((a) => a.status === "approved");
  const mine = open ? pending.filter((a) => a.run_id === open.run.id) : [];
  const flows: { title: string; text: string; button: string; run?: () => void; note?: string }[] =
    role === "nurse"
      ? [
          { title: "What to do today", text: "Reads your unread messages, unverified records and low stock.", button: "Ask", run: () => ask(undefined, "What do I have to do today?") },
          { title: "Message a clinician", text: "Drafts a short message. You edit it and approve before anything is sent.", button: "Draft a message", run: () => ask(undefined, "Draft a message to the clinician about records that need correction.") },
          { title: "Stock alert", text: "Writes up medicines below their reorder level.", button: "Draft a stock message", run: () => ask(undefined, "Draft a message to the clinician about low stock.") },
        ]
      : role === "clinician"
      ? [
          { title: "Follow-up call lists", text: "Finds patients due for a call and drafts the list.", button: "Draft a list", run: () => ask(undefined, "Which of my patients need follow up this week?") },
          { title: "Clinic rules", text: "Looks up your clinic's policies and quotes them.", button: "Ask about a rule", run: () => ask(undefined, "What is our A1C follow-up rule?") },
          { title: "Spend comparison", text: "Compares Medicaid and Medicare drug spend.", button: "Compare", run: () => ask(undefined, "Compare Medicaid and Medicare drug spend.") },
        ]
      : role === "executive"
      ? [
          { title: "Spend comparison", text: "Compares Medicaid and Medicare drug spend.", button: "Compare", run: () => ask(undefined, "Compare Medicaid and Medicare drug spend.") },
          { title: "No-shows by clinic", text: "Shows which clinic misses more visits.", button: "Ask", run: () => ask(undefined, "Which clinic has the higher no-show rate?") },
          { title: "Weekly summary", text: "Emails the leadership team the key numbers.", button: "See the schedule", note: "Sent by the scheduled digest. Admins can preview it." },
        ]
      : [
          { title: "Spend comparison", text: "Compares Medicaid and Medicare drug spend.", button: "Compare", run: () => ask(undefined, "Compare Medicaid and Medicare drug spend.") },
          { title: "No-shows by clinic", text: "Shows which clinic misses more visits.", button: "Ask", run: () => ask(undefined, "Which clinic has the higher no-show rate?") },
          { title: "Weekly summary", text: "Emails the allow-listed team the key numbers.", button: "Preview", run: dg ? previewDigest : undefined },
        ];

  return (
    <div className="tw">
      {cfg && !cfg.enabled && <p className="agent-banner">Agents are switched off. New runs are blocked.</p>}
      <div className="tw-work">
        <div className="tw-stagecol">
          <TiffanyStage pose={pose} />
          <div className="hm-row"><div><b>Tiffany</b> <span className="hm-pill">AI agent</span></div></div>
          <div className="hm-card">
            <div className="hm-row"><h2>Waiting for you</h2><span className="hm-pill">{pending.length}</span></div>
            {pending.length === 0 ? <p className="hm-sub">Nothing waiting.</p> : (
              <ul className="hm-list">
                {pending.map((a) => (
                  <li key={a.id} style={{ flexWrap: "wrap", rowGap: 8 }}>
                    <div className="hm-grow" style={{ flexBasis: "100%" }}>{isMsg(a) ? `Message to ${a.payload.to_name ?? "a clinician"}` : <>{isMail(a) ? "Email" : "Call list"}, {ids(a).length} patient{ids(a).length === 1 ? "" : "s"}</>}<div className="hm-sub">{isMsg(a) ? a.payload.subject : a.payload.reason}</div></div>
                    <button className="hm-btn pri" onClick={() => decide(a.id, "approved")}>{isMail(a) || isMsg(a) ? "Approve and send" : "Approve"}</button>
                    <button className="hm-btn" onClick={() => decide(a.id, "rejected")}>Not now</button>
                  </li>
                ))}
              </ul>
            )}
            {note && <p className="hm-sub" role="status" style={{ marginTop: 8, color: "var(--ink)" }}>{note}</p>}
            <p className="hm-sub" style={{ marginTop: 8 }}>Nothing happens until you approve. An approved email goes only to the allow-listed address and holds patient numbers, never names.</p>
          </div>
        </div>

        <div className="tw-mainc">
          <div className="hm-card tw-conv">
            <div className="hm-chips">
              {SUGGEST[role].map((s) => (<button key={s} type="button" className="hm-chip" disabled={busy} onClick={() => ask(undefined, s)}>{s}</button>))}
            </div>
            {!asked && !busy && !open && <p className="hm-sub">Ask Tiffany to do something for your clinic. She uses fixed tools, logs every step, and only reads what your role can read.</p>}
            {asked && <div className="tw-msg"><div className="tw-bub me">{asked}</div></div>}
            {(busy || open) && (
              <div className="tw-msg">
                <span className="tw-who"><img src="/characters/tiffany.webp" alt="" /></span>
                <div className="tw-bub">
                  {busy && <div><span className="tw-dots" aria-hidden="true"><span /><span /><span /></span> Tiffany is working on it</div>}
                  {!busy && open && (
                    <>
                      <div className="tw-answer">{open.run.answer ?? ""}</div>
                      {mine.map((a) => (
                        isMsg(a) ? (
                          <div key={a.id} className="hm-card tw-draft">
                            <div className="hm-row"><div><b>Draft message to {a.payload.to_name ?? "a clinician"}</b> <span className="hm-pill">Waiting for you</span>{a.payload.patient_id ? <div className="hm-sub">About patient #{a.payload.patient_id}</div> : null}</div></div>
                            <label className="field">Subject
                              <input maxLength={120} value={(edits[a.id] ?? { subject: a.payload.subject ?? "" }).subject} onChange={(e) => setEdits((x) => ({ ...x, [a.id]: { subject: e.target.value, body: x[a.id]?.body ?? a.payload.body ?? "" } }))} />
                            </label>
                            <label className="field">Message
                              <textarea rows={6} maxLength={1500} value={(edits[a.id] ?? { body: a.payload.body ?? "" }).body} onChange={(e) => setEdits((x) => ({ ...x, [a.id]: { subject: x[a.id]?.subject ?? a.payload.subject ?? "", body: e.target.value } }))} />
                            </label>
                            <p className="hm-sub">Edit anything you like. It is sent only when you approve.</p>
                            <div className="hm-actions" style={{ marginTop: 8 }}><button className="hm-btn pri" onClick={() => decide(a.id, "approved")}>Approve and send</button><button className="hm-btn" onClick={() => decide(a.id, "rejected")}>Not now</button></div>
                          </div>
                        ) : (
                        <div key={a.id} className="hm-card tw-draft">
                          <div className="hm-row">
                            <div><b>{isMail(a) ? "Draft email" : "Draft call list"}</b> <span className="hm-pill">Waiting for you</span><div className="hm-sub">{ids(a).length} patient{ids(a).length === 1 ? "" : "s"}: {ids(a).map((p) => "#" + p).join(", ")}</div></div>
                            <div className="hm-actions"><button className="hm-btn pri" onClick={() => decide(a.id, "approved")}>{isMail(a) ? "Approve and send" : "Approve"}</button><button className="hm-btn" onClick={() => decide(a.id, "rejected")}>Not now</button></div>
                          </div>
                        </div>
                        )
                      ))}
                      <details className="tw-how">
                        <summary>How Tiffany worked this out</summary>
                        <ol className="agent-trace">
                          {open.steps.map((st) => (
                            <li key={st.seq} className={"agent-step " + st.kind}>
                              <span className="agent-kind">{KIND_LABEL[st.kind]}</span>
                              <code>{summary(st)}</code>
                            </li>
                          ))}
                        </ol>
                        <p className="hm-sub">
                          Status {open.run.status}. {open.run.prompt_tokens + open.run.completion_tokens} tokens, {open.run.latency_ms ?? 0} ms
                          {open.run.est_cost_usd > 0 ? `, about $${open.run.est_cost_usd.toFixed(4)}` : ""}.
                        </p>
                      </details>
                    </>
                  )}
                </div>
              </div>
            )}
            {err && <p className="agent-err" role="alert">{err}</p>}
            <form onSubmit={ask} className="hm-ask">
              <label htmlFor="agent-q" className="sr-only">Question</label>
              <input id="agent-q" value={q} onChange={(e) => setQ(e.target.value)} maxLength={500} placeholder="Ask Tiffany to do something for your clinic" />
              <button className="hm-btn pri" type="submit" disabled={busy || !q.trim()}>{busy ? "Working..." : "Ask"}</button>
            </form>
          </div>

          <div>
            <div className="hm-label">What she can do</div>
            <div className="hm-grid">
              {flows.map((f) => (
                <div key={f.title} className="hm-card tw-flow">
                  <div><h2>{f.title}</h2><p className="hm-sub">{f.text}</p>{f.note && <p className="hm-sub" style={{ marginTop: 6 }}>{f.note}</p>}</div>
                  {f.run && <div><button className="hm-btn" disabled={busy} onClick={f.run}>{f.button}</button></div>}
                </div>
              ))}
            </div>
          </div>

          <div className="hm-card">
            <h2>Follow-ups</h2>
            <p className="hm-sub">Lists you approved. Email one to yourself with the button.</p>
            {approved.length === 0 ? <p className="hm-sub" style={{ marginTop: 6 }}>Approve a draft and it appears here.</p> : (
              <ul className="hm-list">
                {approved.map((a) => (
                  <li key={a.id} style={{ flexWrap: "wrap", rowGap: 8 }}>
                    <div className="hm-grow" style={{ flexBasis: "100%" }}>{isMsg(a) ? "" : isMail(a) ? "Emailed list: " : "Call patients "}{isMsg(a) ? `Message to ${a.payload.to_name ?? "clinician"}: ${a.payload.subject ?? ""}` : ids(a).map((p) => "#" + p).join(", ")}<div className="hm-sub">{isMsg(a) ? "" : a.payload.reason}{a.outcome ? " · " + a.outcome : ""}</div></div>
                    {!isMsg(a) && !(a.outcome ?? "").startsWith("emailed") && <button className="hm-btn" onClick={() => emailIt(a.id)}>Email me this</button>}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="hm-card">
            <h2>Recent runs</h2>
            {runs.length === 0 ? <p className="hm-sub">No runs yet.</p> : (
              <ul className="agent-runs">
                {runs.map((r) => (
                  <li key={r.id}>
                    <button type="button" className="agent-run" onClick={() => { setAsked(r.question); show(r.id); }}>
                      <span>{r.question}</span><small>{r.status}</small>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>

      {preview && role === "admin" && <div className="hm-card"><h2>Weekly summary preview</h2><pre className="agent-preview">{preview}</pre></div>}
      {dgMsg && <p className="hm-sub" role="status">{dgMsg}</p>}

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

      {role === "admin" && dg && (
        <div className="card">
          <h3>Email digest</h3>
          <p className="agent-note">
            A daily summary with totals only, never patient names or numbers. It goes only to addresses on the allow list
            ({dg.recipients.filter((r) => r.enabled).length === 0 ? "none yet" : dg.recipients.filter((r) => r.enabled).map((r) => r.email).join(", ")}) and stops when the kill switch is off.
          </p>
          <div className="agent-btns">
            <button type="button" disabled={dgBusy} onClick={previewDigest}>Preview</button>
            <button type="button" className="primary" disabled={dgBusy || dg.recipients.filter((r) => r.enabled).length === 0} onClick={sendDigestNow}>Send now</button>
          </div>
          {dgMsg && <p className="agent-meta" role="status">{dgMsg}</p>}
          {preview && <pre className="agent-preview">{preview}</pre>}
          {dg.log.length > 0 && (
            <div className="agent-table">
              <table>
                <thead><tr><th>When</th><th>To</th><th>Status</th><th>Note</th></tr></thead>
                <tbody>
                  {dg.log.map((r) => (
                    <tr key={r.id}><td>{new Date(r.at).toLocaleString()}</td><td>{r.recipient}</td><td>{r.status}</td><td>{r.reason ?? r.narrative ?? ""}</td></tr>
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
