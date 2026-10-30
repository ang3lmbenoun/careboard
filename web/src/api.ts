export type User = { name: string; role: "admin" | "clinician" | "executive" };

let token: string | null = null;
export const setToken = (t: string | null) => {
  token = t;
};

export class ApiError extends Error {
  status: number;
  constructor(status: number) {
    super(`HTTP ${status}`);
    this.status = status;
  }
}

export async function api<T>(path: string): Promise<T> {
  const res = await fetch(`/api/${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new ApiError(res.status);
  return res.json();
}

export async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`/api/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new ApiError(res.status);
  return res.json();
}
