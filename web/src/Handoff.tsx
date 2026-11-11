import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api, ApiError, post, type User } from "./api";

type Contact = { id: number; display_name: string; role: string };
type Msg = {
  id: number; to_user: number; patient_id: number | null; parent_id: number | null; subject: string; body: string;
  drafted_by_agent: boolean; created_at: string; read_at: string | null; mine: boolean; other_name: string; other_role: string | null;
};
type Todo = { record_type: "patient" | "medication" | "reading"; record_id: number; patient_id: number; happened: string | null; label: string; status: "verified" | "needs_correction" | null; note: string | null; checked_at: string | null };
type Item = { item_id: number; drug: string; drug_class: string; unit: string; reorder_level: number; quantity: number | null; counted_at: string | null; note: string | null; low: boolean };

const when = (s: string) => new Date(s).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const fieldErr = (e: unknown, f: string) => (e instanceof ApiError ? e.body?.issues?.find((i) => i.field === f)?.message : undefined);
const generic = (e: unknown) => (e instanceof ApiError ? (e.status === 403 ? "Your role cannot do that." : e.body?.error ?? "Could not save.") : "Could not save.");

/* ------------------------------------------------------------ Messages */

export function Messages({ role, replyTo, onChanged }: { role: User["role"]; replyTo?: number; onChanged?: () => void }) {
  const [msgs, setMsgs] = useState<Msg[] | null>(null);
  const [people, setPeople] = useState<Contact[]>([]);
  const [to, setTo] = useState<number | "">("");
  const [patient, setPatient] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [parent, setParent] = useState<number | undefined>();
  const [err, setErr] = useState<unknown>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<"in" | "out">("in");

  const load = useCallback(async () => {
    try { setMsgs(await api<Msg[]>("messages")); setPeople(await api<Contact[]>("handoff/contacts")); } catch { setMsgs([]); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (replyTo && msgs) { const m = msgs.find((x) => x.id === replyTo); if (m) startReply(m); } /* eslint-disable-next-line */ }, [replyTo, msgs?.length]);

  function startReply(m: Msg) {
    const other = m.mine ? m.to_user : null;
    const peer = people.find((p) => p.display_name === m.other_name);
    setTo((other ?? peer?.id ?? "") as number | "");
    setSubject(m.subject.startsWith("Re: ") ? m.subject : `Re: ${m.subject}`.slice(0, 120));
    setParent(m.id);
    setPatient(m.patient_id ? String(m.patient_id) : "");
    setBody("");
  }

  async function send(e: FormEvent) {
    e.preventDefault();
    if (busy || to === "") return;
    setBusy(true); setErr(null); setNote("");
    try {
      const pn = patient.trim() ? Number(patient) : undefined;
      const r = await post<{ id: number; notice: string }>("messages", { to_user: to, patient_id: pn, parent_id: parent, subject, body });
      setNote(r.notice === "sent" ? "Sent. An email notice went to the allow-listed address." : "Sent in the app. No email provider key is set, so no email notice went out.");
      setSubject(""); setBody(""); setPatient(""); setParent(undefined);
      await load(); onChanged?.();
    } catch (x) { setErr(x); } finally { setBusy(false); }
  }

  async function open(m: Msg) {
    if (m.mine || m.read_at) return;
    try { await post(`messages/${m.id}/read`, {}); await load(); onChanged?.(); } catch { /* the message stays unread */ }
  }

  const list = (msgs ?? []).filter((m) => (view === "in" ? !m.mine : m.mine));
  const unread = (msgs ?? []).filter((m) => !m.mine && !m.read_at).length;
  const other = role === "nurse" ? "clinician" : "nurse";

  return (
    <div className="hm-cols">
      <div className="hm-card">
        <div className="hm-row">
          <div className="hm-actions">
            <button className={"hm-btn" + (view === "in" ? " pri" : "")} onClick={() => setView("in")}>Inbox{unread ? ` (${unread})` : ""}</button>
            <button className={"hm-btn" + (view === "out" ? " pri" : "")} onClick={() => setView("out")}>Sent</button>
          </div>
        </div>
        {msgs && list.length === 0 && <p className="hm-sub" style={{ marginTop: 10 }}>{view === "in" ? "No messages yet." : "You have not sent anything yet."}</p>}
        <ul className="hm-list">
          {list.map((m) => (
            <li key={m.id} style={{ alignItems: "flex-start" }}>
              <details onToggle={(e) => (e.currentTarget as HTMLDetailsElement).open && void open(m)} style={{ flex: 1 }}>
                <summary style={{ cursor: "pointer" }}>
                  <b style={{ fontWeight: !m.mine && !m.read_at ? 700 : 500 }}>{m.subject}</b>{" "}
                  {!m.mine && !m.read_at && <span className="hm-pill">New</span>}{" "}
                  {m.drafted_by_agent && <span className="hm-pill ok">Drafted by Tiffany</span>}
                  <div className="hm-sub">{m.mine ? "To" : "From"} {m.other_name}{m.patient_id ? ` · patient #${m.patient_id}` : ""} · {when(m.created_at)}</div>
                </summary>
                <p style={{ whiteSpace: "pre-wrap", margin: "8px 0" }}>{m.body}</p>
                <button className="hm-btn" type="button" onClick={() => startReply(m)}>Reply</button>
              </details>
            </li>
          ))}
        </ul>
      </div>

      <form className="hm-card" onSubmit={send}>
        <h2>{parent ? "Reply" : `Message a ${other}`}</h2>
        <label className="field">To
          <select value={to} onChange={(e) => setTo(e.target.value === "" ? "" : Number(e.target.value))} required>
            <option value="">Choose a {other}</option>
            {people.map((p) => <option key={p.id} value={p.id}>{p.display_name}</option>)}
          </select>
        </label>
        <label className="field">Patient number (optional)
          <input inputMode="numeric" value={patient} onChange={(e) => setPatient(e.target.value.replace(/\D/g, "").slice(0, 9))} />
          {fieldErr(err, "patient_id") && <span className="entry-err">{fieldErr(err, "patient_id")}</span>}
        </label>
        <label className="field">Subject
          <input value={subject} maxLength={120} onChange={(e) => setSubject(e.target.value)} />
          {fieldErr(err, "subject") && <span className="entry-err">{fieldErr(err, "subject")}</span>}
        </label>
        <label className="field">Message
          <textarea rows={6} value={body} maxLength={1500} onChange={(e) => setBody(e.target.value)} />
          {fieldErr(err, "body") && <span className="entry-err">{fieldErr(err, "body")}</span>}
        </label>
        <p className="hm-sub">Use patient numbers, never names. Messages are plain text and stay inside your clinic.</p>
        {err != null && !fieldErr(err, "subject") && !fieldErr(err, "body") && !fieldErr(err, "patient_id") && <p className="entry-err" role="alert">{generic(err)}</p>}
        {note && <p className="hm-sub" role="status" style={{ color: "var(--ink)" }}>{note}</p>}
        <div className="hm-actions" style={{ marginTop: 10 }}>
          <button className="hm-btn pri" type="submit" disabled={busy || to === "" || !subject.trim() || !body.trim()}>{busy ? "Sending..." : "Send"}</button>
          {parent && <button className="hm-btn" type="button" onClick={() => { setParent(undefined); setSubject(""); setBody(""); }}>Cancel reply</button>}
        </div>
      </form>
    </div>
  );
}

/* -------------------------------------------------------------- Verify */

const TYPE_LABEL = { patient: "Patient", medication: "Medicine", reading: "Reading" } as const;

export function Verify({ role, onChanged }: { role: User["role"]; onChanged?: () => void }) {
  const [rows, setRows] = useState<Todo[] | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState("");
  const load = useCallback(async () => { try { setRows(await api<Todo[]>("checks/todo")); } catch { setRows([]); } }, []);
  useEffect(() => { void load(); }, [load]);

  async function mark(t: Todo, status: "verified" | "needs_correction") {
    const key = `${t.record_type}-${t.record_id}`;
    setBusy(key); setErr("");
    try {
      await post("checks", { patient_id: t.patient_id, record_type: t.record_type, record_id: t.record_id, status, note: notes[key]?.trim() || undefined });
      setNotes((n) => ({ ...n, [key]: "" }));
      await load(); onChanged?.();
    } catch (x) { setErr(fieldErr(x, "note") ?? generic(x)); } finally { setBusy(""); }
  }

  const open = (rows ?? []).filter((r) => r.status === null).length;
  const fix = (rows ?? []).filter((r) => r.status === "needs_correction").length;
  return (
    <div className="hm-card">
      <div className="hm-row"><h2>Records entered by nurses</h2><span className="hm-pill">{open} to check · {fix} need correction</span></div>
      <p className="hm-sub">{role === "nurse" ? "Mark each record you entered as verified, or as needing correction with a short note. Nothing is edited: a correction is entered as a new record." : "Review what the nurse checked. You can flag a record that looks wrong."}</p>
      {rows && rows.length === 0 && <p className="hm-sub" style={{ marginTop: 10 }}>No nurse-entered records yet.</p>}
      {err && <p className="entry-err" role="alert">{err}</p>}
      <ul className="hm-list">
        {(rows ?? []).map((t) => {
          const key = `${t.record_type}-${t.record_id}`;
          return (
            <li key={key} style={{ alignItems: "flex-start", flexWrap: "wrap" }}>
              <div className="hm-grow">
                {TYPE_LABEL[t.record_type]} · patient #{t.patient_id} · {t.label.replace(/^(Patient record|Medicine): /, "")}
                <div className="hm-sub">{t.happened ?? ""}{t.status && t.checked_at ? ` · ${t.status === "verified" ? "Verified" : "Needs correction"} ${when(t.checked_at)}` : ""}{t.note ? ` · ${t.note}` : ""}</div>
              </div>
              {t.status && <span className={"hm-pill" + (t.status === "verified" ? " ok" : "")}>{t.status === "verified" ? "Verified" : "Needs correction"}</span>}
              {(t.status === null || t.status === "needs_correction" || role === "clinician") && (
                <div className="hm-actions" style={{ width: "100%", marginTop: 6 }}>
                  <input style={{ flex: 1, minWidth: 140 }} placeholder="Note (optional)" maxLength={200} aria-label="Note" value={notes[key] ?? ""} onChange={(e) => setNotes((n) => ({ ...n, [key]: e.target.value }))} />
                  {role === "nurse" && t.status === null && <button className="hm-btn pri" disabled={busy === key} onClick={() => mark(t, "verified")}>Verified</button>}
                  <button className="hm-btn" disabled={busy === key} onClick={() => mark(t, "needs_correction")}>{role === "nurse" ? "Needs correction" : "Flag for correction"}</button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/* --------------------------------------------------------------- Stock */

export function Stock({ role, onChanged }: { role: User["role"]; onChanged?: () => void }) {
  const [items, setItems] = useState<Item[] | null>(null);
  const [qty, setQty] = useState<Record<number, string>>({});
  const [err, setErr] = useState<{ id: number; text: string } | null>(null);
  const load = useCallback(async () => { try { setItems(await api<Item[]>("stock")); } catch { setItems([]); } }, []);
  useEffect(() => { void load(); }, [load]);

  async function count(i: Item) {
    const v = qty[i.item_id];
    if (v === undefined || v === "") return;
    setErr(null);
    try {
      await post("stock/count", { item_id: i.item_id, quantity: Number(v) });
      setQty((q) => ({ ...q, [i.item_id]: "" }));
      await load(); onChanged?.();
    } catch (x) { setErr({ id: i.item_id, text: fieldErr(x, "quantity") ?? generic(x) }); }
  }

  const low = (items ?? []).filter((i) => i.low).length;
  return (
    <div className="hm-card">
      <div className="hm-row"><h2>Medicine stock</h2><span className={"hm-pill" + (low ? "" : " ok")}>{low ? `${low} below reorder level` : "All above reorder level"}</span></div>
      <p className="hm-sub">{role === "nurse" ? "Enter what you counted on the shelf. Each count is kept as a new entry, so the history stays intact." : "Latest counts from the nurse. Low items are listed first."}</p>
      <ul className="hm-list">
        {(items ?? []).map((i) => (
          <li key={i.item_id} style={{ alignItems: "center", flexWrap: "wrap" }}>
            <div className="hm-grow">
              {i.drug} <span className="hm-sub">({i.drug_class})</span>
              <div className="hm-sub">{i.quantity === null ? "Not counted yet" : `${i.quantity} ${i.unit}${i.counted_at ? ` · counted ${when(i.counted_at)}` : ""}`} · reorder at {i.reorder_level}</div>
            </div>
            {i.low && <span className="hm-pill">Low</span>}
            {role === "nurse" && (
              <div className="hm-actions">
                <input type="number" min={0} inputMode="numeric" style={{ width: 90 }} aria-label={`Counted ${i.drug}`} placeholder="Counted" value={qty[i.item_id] ?? ""} onChange={(e) => setQty((q) => ({ ...q, [i.item_id]: e.target.value }))} />
                <button className="hm-btn pri" disabled={(qty[i.item_id] ?? "") === ""} onClick={() => count(i)}>Save count</button>
              </div>
            )}
            {err?.id === i.item_id && <p className="entry-err" role="alert" style={{ width: "100%" }}>{err.text}</p>}
          </li>
        ))}
      </ul>
    </div>
  );
}
