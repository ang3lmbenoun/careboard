   import { useState, type FormEvent } from "react";

   type User = { name: string; role: string };

   export default function App() {
     const [token, setToken] = useState<string | null>(null);
     const [user, setUser] = useState<User | null>(null);
     const [email, setEmail] = useState("clinician@careboard.dev");
     const [password, setPassword] = useState("");
     const [error, setError] = useState("");
     const [out, setOut] = useState("");

     async function login(e: FormEvent) {
       e.preventDefault();
       setError("");
       const res = await fetch("/api/auth/login", {
         method: "POST",
         headers: { "Content-Type": "application/json" },
         body: JSON.stringify({ email, password }),
       });
       if (!res.ok) {
         setError("Invalid email or password");
         return;
       }
       const data = await res.json();
       setToken(data.token);
       setUser(data.user);
     }

     async function load(path: string) {
       const res = await fetch(`/api/${path}`, {
         headers: { Authorization: `Bearer ${token}` },
       });
       setOut(res.ok ? JSON.stringify(await res.json(), null, 2) : `HTTP ${res.status}`);
     }

     if (!user) {
       return (
         <form onSubmit={login} style={{ maxWidth: 320, margin: "4rem auto" }}>
           <h1>CareBoard</h1>
           <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="email" style={{ width: "100%" }} />
           <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="password" style={{ width: "100%", marginTop: 8 }} />
           <button type="submit" style={{ marginTop: 8 }}>Sign in</button>
           {error && <p style={{ color: "crimson" }}>{error}</p>}
         </form>
       );
     }

     return (
       <div style={{ maxWidth: 640, margin: "2rem auto" }}>
         <p>Signed in as {user.name} ({user.role})</p>
         <button onClick={() => load("kpis")}>KPIs</button>{" "}
         <button onClick={() => load("patients")}>Patients</button>{" "}
         <button onClick={() => load("audit")}>Audit</button>{" "}
         <button onClick={() => { setToken(null); setUser(null); setOut(""); }}>Sign out</button>
         <pre>{out}</pre>
       </div>
     );
   }