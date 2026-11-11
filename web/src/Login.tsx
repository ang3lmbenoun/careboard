import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { setToken, type User } from "./api";
import Sparkles from "./Sparkles";

type RoleId = User["role"];

// A demo-only password can be supplied at build time (VITE_DEMO_PASSWORD) so visitors
// do not have to leave the page to find it. Without it, the page points to the README.
const DEMO_PASSWORD: string = import.meta.env.VITE_DEMO_PASSWORD ?? "";
const README = "https://github.com/ang3lmbenoun/careboard#demo-accounts";
const REPO = "https://github.com/ang3lmbenoun/careboard";

const Icon = ({ children }: { children: ReactNode }) => (
  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
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
    says: "You can open the patients of one clinic. Names and birth dates stay hidden, even from you.",
  },
  {
    id: "executive",
    email: "executive@careboard.dev",
    label: "Executive",
    blurb: "Steers spend, no-shows and risk",
    icon: <Icon><path d="M5 20V10M12 20V4M19 20v-7" /></Icon>,
    says: "You see totals and the risk register. Any group of fewer than 5 patients is hidden from you.",
  },
  {
    id: "nurse",
    email: "nurse@careboard.dev",
    label: "Nurse",
    blurb: "Enters patients, medicines and readings",
    icon: <Icon><path d="M4 20c0-4 3.6-6 8-6s8 2 8 6" /><circle cx="12" cy="8" r="4" /></Icon>,
    says: "You can add patients, medicines and measurements for one clinic. You cannot read a name back, edit an entry or open any analysis.",
  },
  {
    id: "admin",
    email: "admin@careboard.dev",
    label: "Administrator",
    blurb: "Keeps the system honest",
    icon: <Icon><path d="M12 3l7 3v5c0 4.6-3 8.3-7 10-4-1.7-7-5.4-7-10V6z" /><path d="M9 12l2 2 4-4" /></Icon>,
    says: "You see the audit log and the live control tests. The database refuses you every patient row.",
  },
];

const ROWS: { what: string; sees: Record<RoleId, boolean>; lock?: boolean }[] = [
  { what: "Medicaid spend and clinic trends", sees: { admin: true, clinician: true, executive: true, nurse: false } },
  { what: "Patients in their own clinic", sees: { admin: false, clinician: true, executive: false, nurse: false } },
  { what: "Patient counts across clinics, small groups hidden", sees: { admin: true, clinician: false, executive: true, nurse: false } },
  { what: "Risk register and control map", sees: { admin: true, clinician: false, executive: true, nurse: false } },
  { what: "Audit log of every access", sees: { admin: true, clinician: false, executive: false, nurse: false } },
  { what: "Type in new patients, medicines and readings", sees: { admin: false, clinician: false, executive: false, nurse: true } },
  { what: "Patient names and birth dates", sees: { admin: false, clinician: false, executive: false, nurse: false }, lock: true },
];

function Mark() {
  return (
    <svg className="lg-mark" viewBox="0 0 24 24" aria-hidden="true">
      <rect width="24" height="24" rx="7" fill="#e8c478" />
      <path d="M12 6v12M6 12h12" stroke="#12352b" strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  );
}

export default function Login({ onSignedIn }: { onSignedIn: (user: User, email: string) => void }) {
  const [role, setRole] = useState<RoleId>("clinician");
  const [email, setEmail] = useState("clinician@careboard.dev");
  const [password, setPassword] = useState(DEMO_PASSWORD);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [slow, setSlow] = useState(false);

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
    <div className="login">
      <div className="aurora" aria-hidden="true"><i /><i /><i /></div>
      <Sparkles />

      <header className="lg-hero">
        <div className="lg-brand"><Mark /> CareBoard</div>
        <h1>
          Health data that knows<br />
          <span className="lg-wavy">who&rsquo;s asking.</span>
        </h1>
        <p className="lg-lede">
          CareBoard is a health-analytics app where the database, not the web page, decides who sees what. Pick a role and watch the table below change.
        </p>
      </header>

      <section className="lg-matrix" aria-labelledby="lg-m-title">
        <h2 id="lg-m-title" className="sr">What each role can open</h2>
        <div className="table-wrap">
          <table className="lg-table">
            <thead>
              <tr>
                <th scope="col"><span className="sr">Data</span></th>
                {ROLES.map((r) => (
                  <th scope="col" key={r.id} className={r.id === role ? "on" : ""}>
                    <button type="button" onClick={() => pick(r.id)} aria-pressed={r.id === role}>{r.id === "admin" ? "Admin" : r.label}</button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ROWS.map((row, i) => (
                <tr key={row.what} className={row.lock ? "lock" : ""}>
                  <th scope="row">{row.what}{row.lock && <em> · not even admin</em>}</th>
                  {ROLES.map((r) => (
                    <td key={r.id} className={r.id === role ? "on" : ""}>
                      <span
                        key={`${r.id === role}-${role}`}
                        className={"dot " + (row.sees[r.id] ? "yes" : "no")}
                        style={{ animationDelay: `${i * 45}ms` }}
                      >
                        <span className="sr">{row.sees[r.id] ? "Can open" : "Refused by the database"}</span>
                      </span>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="lg-says" aria-live="polite">{current.says}</p>
        <p className="lg-src">
          Medicaid figures are public CMS data (2024). Patients and clinic activity are synthetic. <a href={REPO} target="_blank" rel="noreferrer">Read the source on GitHub</a>.
        </p>
      </section>

      <main className="lg-formwrap">
        <form className="lg-form" onSubmit={login}>
          <h2>Try it as&hellip;</h2>
          <div className="lg-roles" role="radiogroup" aria-label="Demo account">
            {ROLES.map((r) => (
              <button
                type="button"
                role="radio"
                aria-checked={r.id === role}
                key={r.id}
                className={"lg-role" + (r.id === role ? " on" : "")}
                onClick={() => pick(r.id)}
              >
                <span className="lg-ico">{r.icon}</span>
                <span className="lg-rt"><strong>{r.label}</strong><span>{r.blurb}</span></span>
              </button>
            ))}
          </div>

          <label className="field">
            Email
            <input type="email" autoComplete="username" value={email} onChange={(e) => typed(e.target.value)} />
          </label>
          <label className="field">
            Password
            <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Demo password" />
          </label>
          <p className="lg-hint">
            {DEMO_PASSWORD
              ? "Demo password filled in for you. It only protects synthetic data."
              : <>The demo password is in the <a href={README} target="_blank" rel="noreferrer">README</a>. It only protects synthetic data.</>}
          </p>

          <button type="submit" className="primary" disabled={busy}>
            {busy ? "Signing in…" : `Sign in as ${current.label}`}
          </button>
          {slow && (
            <p className="lg-wake" role="status">
              <span className="lg-spin" aria-hidden="true" /> Waking the free-tier database. The first sign-in after a quiet spell can take up to a minute.
            </p>
          )}
          {error && <p className="error" role="alert">{error}</p>}
        </form>
      </main>
    </div>
  );
}
