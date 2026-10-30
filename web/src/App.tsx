   import { useState, type FormEvent } from "react";
   import { setToken, type User } from "./api";
   import Dashboard from "./Dashboard";

   export default function App() {
     const [user, setUser] = useState<User | null>(null);
     const [email, setEmail] = useState("clinician@careboard.dev");
     const [password, setPassword] = useState("");
     const [error, setError] = useState("");

     async function login(e: FormEvent) {
       e.preventDefault();
       setError("");
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
     }

     if (user) {
       return (
         <Dashboard
           user={user}
           onSignOut={() => {
             setToken(null);
             setUser(null);
           }}
         />
       );
     }

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