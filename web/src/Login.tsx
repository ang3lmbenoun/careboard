import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { setToken, type User } from "./api";
import Icon2 from "./Icon";
import { Carey, TiffanyAvatar } from "./Characters";
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
  return <span className="lg2-mark" aria-hidden="true" />;
}

export default function Login({ onSignedIn }: { onSignedIn: (user: User, email: string) => void }) {
  const [role, setRole] = useState<RoleId>("clinician");
  const [email, setEmail] = useState("clinician@careboard.dev");
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
    <div className="lg2">
      <div className="lg2-bg" aria-hidden="true"><i /><i /><i /><i /><b /></div>
      <header className="lg2-top">
        <div className="lg2-brand"><Mark /> CareBoard</div>
        <button className="theme-btn" type="button" onClick={() => setLook({ theme: dark ? "light" : "dark" })} aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}>
          <Icon2 name={dark ? "sun" : "moon"} />
          {dark ? "Light mode" : "Dark mode"}
        </button>
      </header>

      <div className="lg2-grid">
        <section className="lg2-intro">
          <span className="mono">Demo with synthetic patients</span>
          <h1>Health data that knows <em>who&rsquo;s asking.</em></h1>
          <p className="lg2-lede">
            CareBoard shows each person only what their role allows. The database enforces it, not the web page. Pick a role to try it.
          </p>

          <ol className="lg2-steps">
            <li><b>1</b><span>Pick a role<small>Clinician, executive, nurse or administrator.</small></span></li>
            <li><b>2</b><span>See only what it may<small>The table below shows what each role can open.</small></span></li>
            <li><b>3</b><span>Get help from two AI assistants<small>They only read what your role can read.</small></span></li>
          </ol>

          <div className="lg2-ai">
            <div className="lg2-aic"><span className="lg2-float"><Carey size={40} /></span><div><b>Carey</b><span>Answers questions about the numbers in plain language.</span></div></div>
            <div className="lg2-aic"><span className="lg2-float"><TiffanyAvatar size={40} /></span><div><b>Tiffany <em>AI</em></b><span>Drafts follow-up call lists. Nothing happens until you approve.</span></div></div>
          </div>

          <section className="lg2-matrix" aria-labelledby="lg-m-title">
            <h2 id="lg-m-title" className="lg2-h">What each role can open</h2>
            <div className="table-wrap">
              <table className="lg2-table">
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
                  {ROWS.map((row) => (
                    <tr key={row.what}>
                      <th scope="row">{row.what}{row.lock && <em> · not even admin</em>}</th>
                      {ROLES.map((r) => (
                        <td key={r.id} className={r.id === role ? "on" : ""}>
                          <span className={"lg2-dot " + (row.sees[r.id] ? "yes" : "no")}>
                            <span className="sr">{row.sees[r.id] ? "Can open" : "Refused by the database"}</span>
                          </span>
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="lg2-says" aria-live="polite">{current.says}</p>
          </section>
          <p className="lg2-src">
            Medicaid figures are public CMS data (2024). Patients and clinic activity are synthetic. <a href={REPO} target="_blank" rel="noreferrer">Read the source on GitHub</a>.
          </p>
        </section>

        <main className="lg2-formwrap">
          <form className="lg2-form" onSubmit={login}>
            <h2>Try it as&hellip;</h2>
            <div className="lg2-roles" role="radiogroup" aria-label="Demo account">
              {ROLES.map((r) => (
                <button
                  type="button"
                  role="radio"
                  aria-checked={r.id === role}
                  key={r.id}
                  className={"lg2-role" + (r.id === role ? " on" : "")}
                  onClick={() => pick(r.id)}
                >
                  <span className="lg2-ico">{r.icon}</span>
                  <span className="lg2-rt"><strong>{r.label}</strong><span>{r.blurb}</span></span>
                </button>
              ))}
            </div>

            <label className="lg2-field">
              Email
              <input type="email" autoComplete="username" value={email} onChange={(e) => typed(e.target.value)} />
            </label>
            <label className="lg2-field">
              Password
              <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Demo password" />
            </label>
            <p className="lg2-hint">
              {DEMO_PASSWORD
                ? "Demo password filled in for you. It only protects synthetic data."
                : <>The demo password is in the <a href={README} target="_blank" rel="noreferrer">README</a>. It only protects synthetic data.</>}
            </p>

            <button type="submit" className="lg2-go" disabled={busy}>
              {busy ? "Signing in…" : `Sign in as ${current.label}`}
            </button>
            {slow && (
              <p className="lg2-wake" role="status">
                <span className="lg-spin" aria-hidden="true" /> Waking the free-tier database. The first sign-in after a quiet spell can take up to a minute.
              </p>
            )}
            {error && <p className="error" role="alert">{error}</p>}
          </form>
        </main>
      </div>
    </div>
  );
}
