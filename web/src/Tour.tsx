import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

type Role = "admin" | "clinician" | "executive" | "nurse";
export type TourTab = "overview" | "signals" | "riskcomp" | "riskcare" | "patients" | "audit" | "medicaid" | "payers" | "catalog";

type Step = {
  /** Value of the data-tour attribute on the element to spotlight. No target means a centered card. */
  target?: string;
  /** Page to show before this step. */
  tab?: TourTab;
  /** The step points into the sidebar, which is hidden on small screens until opened. */
  nav?: boolean;
  title: string;
  body: string;
  roles?: Role[];
};

const ROLE_LABEL: Record<Role, string> = { admin: "Administrator", clinician: "Clinician", executive: "Executive", nurse: "Nurse" };

function steps(role: Role): Step[] {
  const all: Step[] = [
    {
      tab: "overview",
      title: "Welcome to CareBoard",
      body: `CareBoard shows how one set of data can answer different questions for different people, while the database decides who may see what. You are signed in as ${ROLE_LABEL[role]}. This tour takes about a minute.`,
    },
    {
      target: "nav", nav: true, tab: "overview",
      title: "Everything lives in the sidebar",
      body: "Pages are grouped by what they are for: Analytics for the data, Risk for what could go wrong, Reference for definitions. You only see the pages your role is allowed to open.",
    },
    {
      target: "signals", tab: "overview",
      title: "Signals to watch",
      body: "Each card is one number worth acting on. The tag in its corner says where it comes from: real public data, synthetic data, a live check of the database, or my own assessment.",
    },
    {
      target: "sig-info", tab: "overview", roles: ["admin", "executive"],
      title: "Where does this number come from?",
      body: "Select the small i on any card. A panel opens with the source, how the figure is calculated, and what to keep in mind before you rely on it.",
    },
    {
      target: "story", tab: "overview",
      title: "What the data says",
      body: "Two short stories behind the numbers: where Medicaid drug money goes, and whether missed appointments are rising. The Medicare comparison has its own page. The headlines are computed from the data, not typed in.",
    },
    {
      target: "nav-signals", nav: true, tab: "signals", roles: ["admin", "executive"],
      title: "Signals: the full trace",
      body: "Every signal in one place, with its source and calculation, including why the synthetic ones show what they show. This is the page to read before you trust a number.",
    },
    {
      target: "nav-riskcomp", nav: true, tab: "riskcomp", roles: ["admin", "executive"],
      title: "Risk and compliance",
      body: "The risk register, the controls mapped to HIPAA Security Rule areas, and live tests that query the database each time the page loads. If a permission changes, a test turns red.",
    },
    {
      target: "nav-medicaid", nav: true, tab: "medicaid", roles: ["executive"],
      title: "Where Medicaid money goes",
      body: "Real 2024 spending on four diabetes drug classes. Click a bar to drill from class to drug to state.",
    },
    {
      target: "nav-payers", nav: true, tab: "payers",
      title: "Medicaid vs Medicare",
      body: "The same four drug classes under both programs: 2024 side by side, then Medicare from 2020 to 2024. Medicare is national and mostly people 65 and over; Medicaid is by state and covers people with low income. Read the caveats on the page before comparing.",
    },
    {
      target: "nav-audit", nav: true, tab: "audit", roles: ["admin"],
      title: "The audit log",
      body: "Every sign-in, failed sign-in, refused request and question asked of Carey is recorded by the database. Only administrators can read it.",
    },
    {
      target: "nav-riskcare", nav: true, tab: "riskcare", roles: ["clinician"],
      title: "Who needs attention first",
      body: "A ranked list of your clinic's synthetic patients, with the reason next to every flag. The rules are simple on purpose, so you can check them.",
    },
    {
      target: "nav-patients", nav: true, tab: "patients", roles: ["clinician"],
      title: "Patients",
      body: "Each patient shows who pays (Medicare, Medicaid, both, or commercial), A1C and weight over time, and every medicine started or stopped. Filter by coverage to see who uses what. Coverage is synthetic; names and birth dates are hidden from every role by the database, not by the page.",
    },
    {
      target: "nav-catalog", nav: true, tab: "catalog",
      title: "Data catalog",
      body: "What each column means, where it comes from, and which columns your role cannot read. Locked columns are marked.",
    },
    {
      target: "chat-fab", tab: "overview",
      title: "Ask Carey",
      body: "Ask a question in plain words. Carey writes one read-only query against two summary tables and explains the result. Ask it for a patient's name and watch it refuse.",
    },
    {
      tab: "overview",
      title: "That is the tour",
      body: "You can replay it any time from Settings. If you only do one thing next, open a signal's i and follow a number back to its source.",
    },
  ];
  return all.filter((s) => !s.roles || s.roles.includes(role));
}

type Rect = { top: number; left: number; width: number; height: number };
const PAD = 8;
const reduced = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const small = () => typeof window !== "undefined" && window.matchMedia("(max-width: 640px)").matches;

function find(target?: string): HTMLElement | null {
  if (!target) return null;
  const els = Array.from(document.querySelectorAll<HTMLElement>(`[data-tour="${target}"]`));
  return els.find((e) => e.getBoundingClientRect().width > 0) ?? null;
}

export default function Tour({
  role, onClose, onGo, onNav,
}: {
  role: Role;
  onClose: () => void;
  onGo: (tab: TourTab) => void;
  onNav: (open: boolean) => void;
}) {
  const list = useMemo(() => steps(role), [role]);
  const [i, setI] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
  const [popH, setPopH] = useState(0);
  const popRef = useRef<HTMLDivElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);
  const step = list[i];
  const last = i === list.length - 1;

  // Show the right page and sidebar before measuring the target.
  useEffect(() => {
    if (step.tab) onGo(step.tab);
    onNav(!!step.nav && small());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [i]);

  // Follow the target: it may appear late, move, or scroll. One frame loop keeps the spotlight on it.
  useEffect(() => {
    let raf = 0;
    let stopped = false;
    const started = performance.now();
    let scrolled = false;
    const tick = () => {
      if (stopped) return;
      const el = find(step.target);
      if (el) {
        if (!scrolled) {
          scrolled = true;
          el.scrollIntoView({ block: "center", inline: "nearest", behavior: reduced() ? "auto" : "smooth" });
        }
        const b = el.getBoundingClientRect();
        setRect((p) => {
          const n = { top: b.top - PAD, left: b.left - PAD, width: b.width + PAD * 2, height: b.height + PAD * 2 };
          return p && Math.abs(p.top - n.top) < 0.5 && Math.abs(p.left - n.left) < 0.5 && Math.abs(p.width - n.width) < 0.5 && Math.abs(p.height - n.height) < 0.5 ? p : n;
        });
      } else if (!step.target || performance.now() - started > 1500) {
        setRect(null);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
    };
  }, [step.target, i]);

  useLayoutEffect(() => {
    if (popRef.current) setPopH(popRef.current.getBoundingClientRect().height);
  }, [i, rect]);

  useEffect(() => {
    nextRef.current?.focus();
  }, [i]);

  const next = useCallback(() => (last ? onClose() : setI((n) => n + 1)), [last, onClose]);
  const back = useCallback(() => setI((n) => Math.max(0, n - 1)), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight") next();
      else if (e.key === "ArrowLeft") back();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, next, back]);

  // Place the card beside the target when there is room, otherwise below or above it. On a phone it docks at the bottom.
  const vw = typeof window !== "undefined" ? window.innerWidth : 1024;
  const vh = typeof window !== "undefined" ? window.innerHeight : 768;
  const W = Math.min(380, vw - 24);
  let style: React.CSSProperties;
  if (!rect || small()) {
    // Dock on the opposite half of the screen from the target, so the card never covers what it points at.
    style = small() && rect
      ? rect.top + rect.height / 2 > vh / 2
        ? { left: 12, right: 12, top: 12, width: "auto" }
        : { left: 12, right: 12, bottom: 12, width: "auto" }
      : { left: "50%", top: "50%", transform: "translate(-50%, -50%)", width: W };
  } else {
    const roomRight = vw - (rect.left + rect.width) - 16;
    const roomLeft = rect.left - 16;
    let left: number;
    let top: number;
    if (roomRight >= W) {
      left = rect.left + rect.width + 16;
      top = rect.top;
    } else if (roomLeft >= W) {
      left = rect.left - W - 16;
      top = rect.top;
    } else {
      left = rect.left;
      top = rect.top + rect.height + 14;
      if (top + popH > vh - 12) top = Math.max(12, rect.top - popH - 14);
    }
    left = Math.min(Math.max(12, left), vw - W - 12);
    top = Math.min(Math.max(12, top), Math.max(12, vh - popH - 12));
    style = { left, top, width: W };
  }

  return (
    <div className="tr" aria-live="polite">
      <div className="tr-block" />
      {rect ? <div className="tr-spot" style={rect} /> : <div className="tr-dim" />}
      <div className="tr-pop" ref={popRef} role="dialog" aria-modal="true" aria-labelledby="tr-title" style={style}>
        <p className="tr-step">Step {i + 1} of {list.length}</p>
        <h2 id="tr-title">{step.title}</h2>
        <p>{step.body}</p>
        <div className="tr-foot">
          <div className="tr-bar" aria-hidden="true"><i style={{ width: `${((i + 1) / list.length) * 100}%` }} /></div>
          <div className="tr-btns">
            {!last && <button onClick={onClose}>Skip</button>}
            {i > 0 && <button onClick={back}>Back</button>}
            <button ref={nextRef} className="primary" onClick={next}>{last ? "Done" : "Next"}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
