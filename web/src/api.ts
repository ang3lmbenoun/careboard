   export type User = { name: string; role: "admin" | "clinician" | "executive" };

   let token: string | null = null;
   export const setToken = (t: string | null) => {
     token = t;
   };

   export async function api<T>(path: string): Promise<T> {
     const res = await fetch(`/api/${path}`, {
       headers: { Authorization: `Bearer ${token}` },
     });
     if (!res.ok) throw new Error(`HTTP ${res.status}`);
     return res.json();
   }