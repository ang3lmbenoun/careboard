import { useEffect, useRef, useState, type FormEvent } from "react";
import { ApiError, post } from "./api";
import { Carey } from "./Characters";

type Reply = {
  mode: "sql" | "explain" | "refuse";
  answer: string;
  sql?: string;
  columns?: string[];
  rows?: Record<string, unknown>[];
  truncated?: boolean;
};

type Msg = {
  from: "user" | "bot";
  text: string;
  sql?: string;
  columns?: string[];
  rows?: Record<string, unknown>[];
  truncated?: boolean;
  isError?: boolean;
};

const GREETING: Msg = {
  from: "bot",
  text:
    "Hi, I'm Carey, your CareBoard assistant. I can explain the numbers on this page in plain language, or look up " +
    "answers in the Medicaid and clinic summary tables. What would you like to know?",
};

const SUGGESTIONS = [
  "What does no-show rate mean?",
  "Which drug class had the most Medicaid spend?",
  "Which department has the highest no-show rate?",
  "How many appointments were scheduled each year?",
];

const PREVIEW_ROWS = 8;

const show = (v: unknown) => {
  if (v === null || v === undefined) return "";
  if (typeof v === "number") return v.toLocaleString(undefined, { maximumFractionDigits: 4 });
  const s = String(v);
  // Postgres returns sums and counts as strings; add separators to long plain numbers (not years or dates).
  return /^-?\d{5,}(\.\d+)?$/.test(s) ? Number(s).toLocaleString(undefined, { maximumFractionDigits: 4 }) : s;
};

function failureText(e: unknown) {
  if (e instanceof ApiError) {
    if (e.status === 429) return "I need a short break. Please wait a minute and ask again.";
    if (e.status === 503) return "The assistant is not available right now. The rest of CareBoard still works.";
    if (e.status === 401) return "Your session has expired. Please sign in again.";
  }
  return "Something went wrong on my side. Please try again in a moment.";
}

const NURSE_GREETING: Msg = {
  from: "bot",
  text: "Hi, I'm Carey. I can tell you what is waiting for you today: unread messages, records to verify and medicine that is running low. Ask me what to do next.",
};
const NURSE_SUGGESTIONS = ["What do I have to do today?", "Which medicines are low?", "Which records still need verifying?", "Who can I message?"];

export default function Assistant({ role }: { role?: string } = {}) {
  const nurse = role === "nurse";
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([nurse ? NURSE_GREETING : GREETING]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLInputElement>(null);
  const askRef = useRef<(q: string) => void>(() => {});

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [msgs, busy, open]);

  useEffect(() => {
    if (open) field.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  useEffect(() => {
    const onAsk = (e: Event) => {
      const q = (e as CustomEvent<string>).detail;
      setOpen(true);
      if (q) window.setTimeout(() => askRef.current(q), 0);
    };
    window.addEventListener("careboard:ask", onAsk);
    return () => window.removeEventListener("careboard:ask", onAsk);
  }, []);

  async function ask(text: string) {
    const question = text.trim();
    if (!question || busy) return;
    const history = msgs
      .filter((m) => !m.isError)
      .slice(-6)
      .map((m) => ({ role: m.from === "user" ? "user" : "assistant", content: m.text }));
    setMsgs((m) => [...m, { from: "user", text: question }]);
    setInput("");
    setBusy(true);
    try {
      const r = await post<Reply>("assistant", { message: question, history });
      setMsgs((m) => [
        ...m,
        { from: "bot", text: r.answer, sql: r.sql, columns: r.columns, rows: r.rows, truncated: r.truncated },
      ]);
    } catch (e) {
      setMsgs((m) => [...m, { from: "bot", text: failureText(e), isError: true }]);
    } finally {
      setBusy(false);
    }
  }

  askRef.current = (q) => void ask(q);

  function submit(e: FormEvent) {
    e.preventDefault();
    void ask(input);
  }

  return (
    <>
      {open && (
        <section className="chat" role="dialog" aria-label="Carey, the CareBoard assistant">
          <header className="chat-head">
            <div className="chat-who">
              <Carey size={30} />
              <div><strong>Carey</strong><span>CareBoard assistant</span></div>
            </div>
            <button className="ghost" onClick={() => setOpen(false)} aria-label="Close assistant">
              Close
            </button>
          </header>

          <div className="chat-body" aria-live="polite">
            {msgs.map((m, i) => (
              <div key={i} className={"msgrow " + m.from}>
              {m.from === "bot" && <Carey size={26} tag={false} />}
              <div className={"bubble " + m.from + (m.isError ? " bad" : "")}>
                <p>{m.text}</p>
                {m.rows && m.rows.length > 0 && m.columns && (
                  <div className="table-wrap">
                    <table className="data mini-data">
                      <thead>
                        <tr>{m.columns.map((c) => <th key={c}>{c.replace(/_/g, " ")}</th>)}</tr>
                      </thead>
                      <tbody>
                        {m.rows.slice(0, PREVIEW_ROWS).map((r, ri) => (
                          <tr key={ri}>{m.columns!.map((c) => <td key={c}>{show(r[c])}</td>)}</tr>
                        ))}
                      </tbody>
                    </table>
                    {(m.rows.length > PREVIEW_ROWS || m.truncated) && (
                      <p className="note">Showing the first {PREVIEW_ROWS} rows.</p>
                    )}
                  </div>
                )}
                {m.sql && (
                  <details className="sqlbox">
                    <summary>Show the query I ran</summary>
                    <pre>{m.sql}</pre>
                  </details>
                )}
              </div>
              </div>
            ))}
            {busy && <div className="bubble bot typing">Carey is thinking…</div>}
            {msgs.length === 1 && !busy && (
              <div className="chips">
                {(nurse ? NURSE_SUGGESTIONS : SUGGESTIONS).map((s) => (
                  <button key={s} type="button" className="chip" onClick={() => void ask(s)}>
                    {s}
                  </button>
                ))}
              </div>
            )}
            <div ref={bottom} />
          </div>

          <form className="chat-form" onSubmit={submit}>
            <input
              ref={field}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask about spend, appointments, no-shows…"
              maxLength={400}
              aria-label="Your question"
            />
            <button type="submit" className="primary send" disabled={busy || !input.trim()}>
              Send
            </button>
          </form>
          <p className="chat-foot">
            AI-generated. Carey reads summary tables only, never patient records. Check the query shown under each
            answer.
          </p>
        </section>
      )}

      <button
        className="chat-fab"
        data-tour="chat-fab"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label={open ? "Close the assistant" : "Open the assistant"}
      >
        <Carey size={22} tag={false} />
        <span>{open ? "Close" : "Ask Carey"}</span>
      </button>
    </>
  );
}
