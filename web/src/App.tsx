import { useState, type FormEvent } from "react";
import { setToken, type User } from "./api";
import Dashboard from "./Dashboard";

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
      <aside className="login-aside">
        <p className="eyebrow">Health analytics</p>
        <h1>CareBoard</h1>
        <p className="tag">
          One dashboard, three views. What each person can see is enforced inside the database through roles,
          column grants and row-level security.
        </p>
        <p className="roles-title">Choose a demo account</p>
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
        <p className="aside-note">
          Medicaid figures come from public CMS State Drug Utilization Data (2024). Clinic operations and patient
          records are synthetic.
        </p>
      </aside>

      <main className="login-main">
        <form className="login-form" onSubmit={login}>
          <h2>Sign in</h2>
          <p className="sub">Pick an account on the left, or type its email.</p>
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
          <button type="submit" className="primary" disabled={busy}>
            {busy ? "Signing in…" : "Sign in"}
          </button>
          {error && <p className="error" role="alert">{error}</p>}
          <p className="fineprint">
            Demo password: see the README. The first sign-in after a quiet period can take up to a minute while the
            database wakes.
          </p>
        </form>
      </main>
    </div>
  );
}
