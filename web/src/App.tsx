import { useState } from "react";
import { setToken, type User } from "./api";
import Dashboard from "./Dashboard";
import Login from "./Login";

export default function App() {
  const [session, setSession] = useState<{ user: User; email: string } | null>(null);

  if (session) {
    return (
      <Dashboard
        user={session.user}
        email={session.email}
        onSignOut={() => {
          setToken(null);
          setSession(null);
        }}
      />
    );
  }
  return <Login onSignedIn={(user, email) => setSession({ user, email })} />;
}
