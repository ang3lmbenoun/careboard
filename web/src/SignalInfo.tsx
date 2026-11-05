import { useEffect, useRef } from "react";
import { TAG_TEXT, byId, type SignalId } from "./signalContent";

type Go = "medicaid" | "riskspend" | "riskops" | "riskcomp" | "riskcare" | "patients" | "audit" | "catalog" | "signals" | "payers";

// A side panel that says where one Overview signal comes from. Shown to administrators and executives only.
// This is a design choice, not security: the text describes methods and holds no patient data.
export default function SignalInfo({ id, onClose, onOpen }: { id: SignalId; onClose: () => void; onOpen: (to: Go) => void }) {
  const s = byId(id);
  const tag = TAG_TEXT[s.tag];
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="si-scrim" onClick={onClose}>
      <aside className="si" role="dialog" aria-modal="true" aria-labelledby="si-title" onClick={(e) => e.stopPropagation()}>
        <header className="si-head">
          <div>
            <span className={`tag tag-${s.tag}`}>{tag.name}</span>
            <h2 id="si-title">{s.label}</h2>
          </div>
          <button ref={closeRef} className="ghost si-x" onClick={onClose} aria-label="Close">×</button>
        </header>
        <p className="si-means">{tag.means}</p>
        <dl className="si-list">
          <dt>Where it comes from</dt>
          <dd>{s.source}</dd>
          <dt>How it is calculated</dt>
          <dd>{s.how}</dd>
          <dt>Keep in mind</dt>
          <dd>{s.caution}</dd>
        </dl>
        <footer className="si-foot">
          {s.page && <button className="primary" onClick={() => { onClose(); onOpen(s.page!); }}>Open the detail</button>}
          <button onClick={() => { onClose(); onOpen("signals"); }}>See all signals</button>
        </footer>
      </aside>
    </div>
  );
}
