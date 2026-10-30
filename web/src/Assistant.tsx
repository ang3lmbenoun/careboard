import { useEffect, useRef, useState, type FormEvent } from "react";
import { ApiError, post } from "./api";

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
    "Hi, I'm Carry, your CareBoard assistant. I can explain the numbers on this page in plain language, or look up " +
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

export default function Assistant() {
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([GREETING]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLInputElement>(null);

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

  function submit(e: FormEvent) {
    e.preventDefault();
    void ask(input);
  }

  return (
    <>
      {open && (
        <section className="chat" role="dialog" aria-label="Carry, the CareBoard assistant">
          <header className="chat-head">
            <div>
              <strong>Carry</strong>
              <span>CareBoard assistant</span>
            </div>
            <button className="ghost" onClick={() => setOpen(false)} aria-label="Close assistant">
              Close
            </button>
          </header>

          <div className="chat-body" aria-live="polite">
            {msgs.map((m, i) => (
              <div key={i} className={"bubble " + m.from + (m.isError ? " bad" : "")}>
                <p>{m.text}</p>
                {m.rows && m.rows.length > 0 && m.columns && (
                  <div className="table-wrap">
                    <table className="data mini-data">
                      <thead>
                        <tr>{m.columns.map((c) => <th key={c}>{c}</th>)}</tr>
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
            ))}
            {busy && <div className="bubble bot typing">Carry is thinking…</div>}
            {msgs.length === 1 && !busy && (
              <div className="chips">
                {SUGGESTIONS.map((s) => (
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
            AI-generated. Carry reads summary tables only, never patient records. Check the query shown under each
            answer.
          </p>
        </section>
      )}

      <button
        className="chat-fab"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label={open ? "Close the assistant" : "Open the assistant"}
      >
        <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
          <path
            d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v8a2.5 2.5 0 0 1-2.5 2.5H11l-4.2 3.6A.6.6 0 0 1 6 19.1V16h-.5A2.5 2.5 0 0 1 4 13.5z"
            fill="#12352b"
          />
          <circle cx="9" cy="9.5" r="1.2" fill="#f3e9cf" />
          <circle cx="12.5" cy="9.5" r="1.2" fill="#f3e9cf" />
          <circle cx="16" cy="9.5" r="1.2" fill="#f3e9cf" />
        </svg>
        <span>{open ? "Close" : "Ask Carry"}</span>
      </button>
    </>
  );
}
