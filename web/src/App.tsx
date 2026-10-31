import { useState, type FormEvent } from "react";
import { setToken, type User } from "./api";
import Dashboard from "./Dashboard";
import Sparkles from "./Sparkles";

const ACCOUNTS = [
  {
    email: "admin@careboard.dev",
    name: "Administrator",
    note: "Audit log and aggregate data. Patient rows are denied by the database.",
  },
  {
    email: "clinician@careboard.dev",
    name: "Clinician",
    note: "Patients of one clinic, without names or birth dates.",
  },
  {
    email: "executive@careboard.dev",
    name: "Executive",
    note: "Aggregate Medicaid and operations data only.",
  },
];

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [email, setEmail] = useState("clinician@careboard.dev");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

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
              ? "Invalid email or password"
              : "Server error. Wait a minute and try again."
        );
        return;
      }
      const data = await res.json();
      setToken(data.token);
      setUser(data.user);
    } catch {
      setError("Cannot reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  if (user) {
    return (
      <Dashboard
        user={user}
        email={email}
        onSignOut={() => {
          setToken(null);
          setUser(null);
          setPassword("");
        }}
      />
    );
  }

  return (
    <div className="login">
      <div className="aurora" aria-hidden="true"><i /><i /><i /></div>
      <Sparkles />
      <aside className="login-aside">
        <p className="eyebrow">Health analytics</p>
        <h1>CareBoard</h1>
        <p className="tag">
          One dashboard, three views. What each person can see is enforced inside the database through roles,
          column grants and row-level security.
        </p>
          <p className="roles-title">Choose your workspace</p>
        <div className="roles">
          {ACCOUNTS.map((a) => (
            <button
              type="button"
              key={a.email}
              className={"role-card" + (email === a.email ? " on" : "")}
              onClick={() => setEmail(a.email)}
            >
              <strong>{a.name}</strong>
              <span>{a.note}</span>
            </button>
          ))}
        </div>
          <div className="login-trust" aria-label="Data and access summary">
            <div><span className="trust-mark" aria-hidden="true">✓</span><span><strong>Access follows your role</strong><small>Database permissions limit what each account can read.</small></span></div>
            <div><span className="trust-mark" aria-hidden="true">i</span><span><strong>Sources are labeled</strong><small>CMS Medicaid data; synthetic clinic and patient records.</small></span></div>
          </div>
      </aside>

      <main className="login-main">
        <form className="login-form" onSubmit={login}>
          <h2>Sign in</h2>
          <p className="sub">Choose a role to load its demo account, then sign in.</p>
          <div className="form-step"><span>1</span><span>Select a workspace</span><span className="step-line"/><span>2</span><span>Enter demo password</span></div>
          <label className="field">
            Email
            <input
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="email"
            />
          </label>
          <label className="field">
            Password
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="password"
            />
          </label>
          <button type="submit" className="primary login-submit" disabled={busy}>
            {busy ? "Signing in…" : "Sign in"}
          </button>
          {error && <p className="error" role="alert">{error}</p>}
          <div className="login-foot"><p className="fineprint"><strong>Demo access</strong><br/>Use the shared demo password described in the README. These accounts contain synthetic patient records.</p><p className="wake-note"><span className="wake-dot"/>First sign-in after inactivity may take up to a minute while the demo database wakes.</p></div>
        </form>
      </main>
    </div>
  );
}
