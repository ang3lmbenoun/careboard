import { useEffect, useState, type FormEvent, type PointerEvent, type ReactNode } from "react";
import { setToken, type User } from "./api";
import Icon2 from "./Icon";
import Logo from "./Logo";
import { resolvedTheme, useAppearance, watchSystemTheme } from "./appearance";


type RoleId = User["role"];

// A demo-only password can be supplied at build time (VITE_DEMO_PASSWORD) so visitors
// do not have to leave the page to find it. Without it, the page points to the README.
const DEMO_PASSWORD: string = import.meta.env.VITE_DEMO_PASSWORD ?? "";
const README = "https://github.com/ang3lmbenoun/careboard#demo-accounts";
const REPO = "https://github.com/ang3lmbenoun/careboard";

const Icon = ({ children }: { children: ReactNode }) => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {children}
  </svg>
);

const ROLES: { id: RoleId; email: string; label: string; blurb: string; icon: ReactNode; says: string }[] = [
  {
    id: "clinician",
    email: "clinician@careboard.dev",
    label: "Clinician",
    blurb: "Works one clinic's patient list",
    icon: <Icon><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z" /></Icon>,
    says: "You can open the patients of one clinic, read the nurses' messages, check their records and watch medicine stock. Names and birth dates stay hidden, even from you.",
  },
  {
    id: "executive",
    email: "executive@careboard.dev",
    label: "Executive",
    blurb: "Steers spend, no-shows and risk",
    icon: <Icon><path d="M5 20V10M12 20V4M19 20v-7" /></Icon>,
    says: "You see totals, the Medicaid and Medicare comparison, the risk register and the compliance view. Any group of fewer than 5 patients is hidden from you.",
  },
  {
    id: "nurse",
    email: "nurse@careboard.dev",
    label: "Nurse",
    blurb: "Enters patients, medicines and readings",
    icon: <Icon><path d="M4 20c0-4 3.6-6 8-6s8 2 8 6" /><circle cx="12" cy="8" r="4" /></Icon>,
    says: "You can add patients, medicines and measurements for one clinic, message the clinician and flag stock. You cannot read a name back, edit an entry or open any analysis.",
  },
  {
    id: "admin",
    email: "admin@careboard.dev",
    label: "Administrator",
    blurb: "Keeps the system honest",
    icon: <Icon><path d="M12 3l7 3v5c0 4.6-3 8.3-7 10-4-1.7-7-5.4-7-10V6z" /><path d="M9 12l2 2 4-4" /></Icon>,
    says: "You see the audit log, the live control tests and the agent evaluation results. The database refuses you every patient row.",
  },
];

const ROWS: { what: string; sees: Record<RoleId, boolean>; lock?: boolean }[] = [
  { what: "Medicaid spend and clinic trends", sees: { admin: true, clinician: true, executive: true, nurse: false } },
  { what: "Medicaid vs Medicare comparison and drug classes", sees: { admin: true, clinician: true, executive: true, nurse: false } },
  { what: "Patients in their own clinic", sees: { admin: false, clinician: true, executive: false, nurse: false } },
  { what: "Patient counts across clinics, small groups hidden", sees: { admin: true, clinician: false, executive: true, nurse: false } },
  { what: "Type in new patients, medicines and readings", sees: { admin: false, clinician: false, executive: false, nurse: true } },
  { what: "Messages, record checks and medicine stock", sees: { admin: false, clinician: true, executive: false, nurse: true } },
  { what: "Risk register, control map and compliance", sees: { admin: true, clinician: false, executive: true, nurse: false } },
  { what: "Audit log and agent evaluation results", sees: { admin: true, clinician: false, executive: false, nurse: false } },
  { what: "Patient names and birth dates", sees: { admin: false, clinician: false, executive: false, nurse: false }, lock: true },
];

const TIFFANY: Record<RoleId, string> = {
  clinician: "Drafted a follow-up call list for your clinic.",
  executive: "Drafted a summary of this month’s no-show risk.",
  nurse: "Drafted a status message for the clinician.",
  admin: "Drafted a digest of today’s refused requests.",
};

const ACCENT: Record<RoleId, string> = { clinician: "#38c9c3", executive: "#e3c56a", nurse: "#36c28a", admin: "#7db4ff" };

const Lock = () => (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="5" y="11" width="14" height="9" rx="2.2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" />
  </svg>
);

const Bars = () => (
  <div className="lg5-bars" aria-hidden="true">
    {[62, 40, 88, 52, 100, 70].map((h, i) => <i key={i} className={i % 2 ? "b" : "a"} style={{ ["--h" as string]: h + "%", ["--d" as string]: i * 70 + "ms" }} />)}
  </div>
);

type Tile = { id: string; title: string; sub: string; span?: number; roles: RoleId[]; body: ReactNode };
const TILES: Tile[] = [
  { id: "spend", title: "Drug spend", sub: "Medicaid vs Medicare", span: 2, roles: ["clinician", "executive", "admin"], body: <Bars /> },
  { id: "patients", title: "Patients", sub: "One clinic", roles: ["clinician"], body: (
    <div className="lg5-rows" aria-hidden="true">{[0, 1, 2].map((i) => <div key={i}><b /><i className="lg5-redact" /><u /></div>)}</div>
  ) },
  { id: "handoff", title: "Hand-off", sub: "Messages and stock", roles: ["clinician", "nurse"], body: (
    <div className="lg5-chat" aria-hidden="true"><span /><span className="r" /><em><i /></em></div>
  ) },
  { id: "risk", title: "Risk and compliance", sub: "Live control tests", roles: ["executive", "admin"], body: (
    <div className="lg5-rows ck" aria-hidden="true">{[0, 1, 2].map((i) => <div key={i}><s /><i /></div>)}</div>
  ) },
  { id: "audit", title: "Audit log", sub: "Every access", roles: ["admin"], body: (
    <div className="lg5-rows lg" aria-hidden="true">{["ok", "no", "ok"].map((k, i) => <div key={i}><s className={k} /><i /></div>)}</div>
  ) },
  { id: "entry", title: "Add records", sub: "Patients, medicines", roles: ["nurse"], body: (
    <div className="lg5-add" aria-hidden="true"><span>+ Patient</span><span>+ Medicine</span><span>+ Reading</span></div>
  ) },
  { id: "names", title: "Names and birth dates", sub: "Not even admin", roles: [], body: (
    <div className="lg5-names" aria-hidden="true"><i className="lg5-redact" /><i className="lg5-redact short" /></div>
  ) },
];

function AccessLens({ role, label }: { role: RoleId; label: string }) {
  const open = TILES.filter((t) => t.roles.includes(role)).map((t) => t.title);
  return (
    <div className="lg5-win" style={{ ["--accent" as string]: ACCENT[role] }}>
      <div className="lg5-bar">
        <span className="lg5-dots" aria-hidden="true"><i /><i /><i /></span>
        <span className="lg5-wtitle">CareBoard as {label}</span>
        <span className="lg5-legend" aria-hidden="true"><i className="o" />Open<i className="l" />Locked</span>
      </div>
      <p className="sr" aria-live="polite">{label} can open: {open.join(", ")}. Everything else is refused by the database.</p>
      <div className="lg5-tiles">
        {TILES.map((t, i) => {
          const on = t.roles.includes(role);
          return (
            <div key={t.id} className={"lg5-tile" + (on ? " open" : " locked")} style={{ gridColumn: t.span ? `span ${t.span}` : undefined, ["--i" as string]: i }} aria-hidden="true">
              <div className="lg5-th"><b>{t.title}</b><span>{t.sub}</span></div>
              <div className="lg5-tb" key={role + t.id}>{t.body}</div>
              {!on && <div className="lg5-lock"><Lock /><span>{t.id === "names" ? "Locked for everyone" : "Locked"}</span></div>}
            </div>
          );
        })}
      </div>
      <div className="lg5-ask"><img src="/characters/carey.webp" alt="" width="22" height="22" /><span>Ask Carey, the AI assistant</span></div>
    </div>
  );
}

export default function Login({ onSignedIn }: { onSignedIn: (user: User, email: string) => void }) {
  const [role, setRole] = useState<RoleId>("executive");
  const [email, setEmail] = useState("executive@careboard.dev");
  const [password, setPassword] = useState(DEMO_PASSWORD);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [slow, setSlow] = useState(false);
  const [look, setLook] = useAppearance();
  useEffect(() => watchSystemTheme(), []);
  const dark = resolvedTheme(look.theme) === "dark";

  useEffect(() => {
    if (!busy) {
      setSlow(false);
      return;
    }
    const t = setTimeout(() => setSlow(true), 3500);
    return () => clearTimeout(t);
  }, [busy]);

  const pick = (r: RoleId) => {
    setRole(r);
    setEmail(ROLES.find((x) => x.id === r)!.email);
    setError("");
  };
  const typed = (v: string) => {
    setEmail(v);
    const hit = ROLES.find((x) => x.email === v.trim().toLowerCase());
    if (hit) setRole(hit.id);
  };
  const current = ROLES.find((r) => r.id === role)!;
  const glow = (e: PointerEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    el.style.setProperty("--mx", `${e.clientX}px`);
    el.style.setProperty("--my", `${e.clientY}px`);
  };

  async function login(e: FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) {
        setError(
          res.status === 429
            ? "Too many attempts. Wait 15 minutes and try again."
            : res.status === 401
              ? "That email and password do not match."
              : "Server error. Wait a minute and try again."
        );
        return;
      }
      const data = await res.json();
      setToken(data.token);
      onSignedIn(data.user, email);
    } catch {
      setError("Cannot reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="lg5" onPointerMove={glow}>
      <div className="lg5-aurora" aria-hidden="true"><i /><i /><i /><i /><s /><s /><u /></div>
      <svg className="lg5-ecg" viewBox="0 0 1440 220" preserveAspectRatio="none" aria-hidden="true">
        <defs>
          <linearGradient id="lg5-ecg-g" x1="0" x2="1" y1="0" y2="0">
            <stop offset="0" stopColor="#38c9c3" stopOpacity="0" />
            <stop offset="0.5" stopColor="#38c9c3" stopOpacity="1" />
            <stop offset="1" stopColor="#e3c56a" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path className="base" d="M0 110 H430 l18 -8 l18 8 H560 l12 16 l20 -86 l20 110 l12 -40 H760 l22 -12 l22 12 H1000 l12 14 l20 -70 l20 90 l12 -34 H1440" />
        <path className="pulse" d="M0 110 H430 l18 -8 l18 8 H560 l12 16 l20 -86 l20 110 l12 -40 H760 l22 -12 l22 12 H1000 l12 14 l20 -70 l20 90 l12 -34 H1440" pathLength="1000" />
      </svg>
      <div className="lg5-glow" aria-hidden="true" />

      <header className="lg5-top">
        <div className="lg5-brand"><Logo size={30} />CareBoard</div>
        <div className="lg5-actions">
          <button className="lg5-theme" type="button" onClick={() => setLook({ theme: dark ? "light" : "dark" })} aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}>
            <Icon2 name={dark ? "sun" : "moon"} />
            {dark ? "Light mode" : "Dark mode"}
          </button>
          <a className="lg5-gh" href={REPO} target="_blank" rel="noreferrer">Source on GitHub</a>
        </div>
      </header>

      <main className="lg5-grid">
        <section className="lg5-story" aria-labelledby="lg5-title">
          <h1 id="lg5-title">Health data that knows who&rsquo;s asking.</h1>
          <p className="lg5-lede">
            Same database, four roles. The database decides what each person can open. Pick a role and watch the app unlock. Tiffany, an AI agent, drafts the follow-up work and waits for a person to approve it.
          </p>

          <div className="lg5-stagewrap">
            <AccessLens role={role} label={current.label} />
            <aside className="lg5-tiff" key={"t" + role} aria-label="Tiffany, an AI agent, has a draft waiting">
              <div className="lg5-portrait"><img src="/characters/tiffany.webp" alt="Tiffany, the CareBoard AI agent" /></div>
              <div className="lg5-tt">
                <div className="lg5-th2"><b>Tiffany</b><span className="lg5-ai">AI agent</span></div>
                <div className="lg5-typing" aria-hidden="true"><i /><i /><i /></div>
                <p>{TIFFANY[role]}</p>
                <div className="lg5-wait"><span className="lg5-approve">Approve</span><span className="lg5-edit">Edit</span><em>Waiting for you</em></div>
              </div>
            </aside>
          </div>
        </section>

        <form className="lg5-form" onSubmit={login}>
          <h2>Sign in to the demo</h2>
          <p className="lg5-sub">Pick who you want to be.</p>
          <div className="lg5-roles" role="radiogroup" aria-label="Demo account">
            {ROLES.map((r) => (
              <button type="button" role="radio" aria-checked={r.id === role} key={r.id} className={"lg5-role" + (r.id === role ? " on" : "")} style={{ ["--accent" as string]: ACCENT[r.id] }} onClick={() => pick(r.id)}>
                <span className="lg5-ico">{r.icon}</span>
                {r.label}
              </button>
            ))}
          </div>
          <p className="lg5-blurb">{current.blurb}</p>

          <label className="lg5-field">
            Email
            <input type="email" autoComplete="username" value={email} onChange={(e) => typed(e.target.value)} />
          </label>
          <label className="lg5-field">
            Password
            <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Demo password" />
          </label>
          <p className="lg5-hint">
            {DEMO_PASSWORD
              ? "Demo password filled in for you. It only protects synthetic data."
              : <>The demo password is in the <a href={README} target="_blank" rel="noreferrer">README</a>. It only protects synthetic data.</>}
          </p>
          <button type="submit" className="lg5-go" disabled={busy}><span>{busy ? "Signing in…" : `Sign in as ${current.label}`}</span></button>
          {slow && (
            <p className="lg5-wake" role="status"><span className="lg-spin" aria-hidden="true" /> Waking the free-tier database. The first sign-in after a quiet spell can take up to a minute.</p>
          )}
          {error && <p className="error" role="alert">{error}</p>}
        </form>
      </main>

      <footer className="lg5-foot">
        <details>
          <summary>Full table: who can open what</summary>
          <div className="table-wrap">
            <table className="lg5-table">
              <thead>
                <tr>
                  <th scope="col"><span className="sr">Data</span></th>
                  {ROLES.map((r) => <th scope="col" key={r.id}>{r.id === "admin" ? "Admin" : r.label}</th>)}
                </tr>
              </thead>
              <tbody>
                {ROWS.map((row) => (
                  <tr key={row.what}>
                    <th scope="row">{row.what}{row.lock && <em> (not even admin)</em>}</th>
                    {ROLES.map((r) => (
                      <td key={r.id}>
                        <span className={"lg5-dot " + (row.sees[r.id] ? "yes" : "no")}><span className="sr">{row.sees[r.id] ? "Can open" : "Refused by the database"}</span></span>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
        <p>
          Medicaid and Medicare Part D figures are public CMS data (2024). Patients and clinic activity are synthetic. The agent passed 102 of 102 evaluation runs (34 adversarial cases, 3 repeats, graded by code, Nov 24, 2026).
        </p>
      </footer>
    </div>
  );
}
