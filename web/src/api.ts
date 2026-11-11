export type User = { name: string; role: "admin" | "clinician" | "executive" | "nurse" };

let token: string | null = null;
export const setToken = (t: string | null) => {
  token = t;
};

export class ApiError extends Error {
  status: number;
  /** Parsed JSON error body when the server sent one (validation messages, for example). */
  body?: { error?: string; issues?: { field: string; message: string }[] };
  constructor(status: number, body?: ApiError["body"]) {
    super(`HTTP ${status}`);
    this.status = status;
    this.body = body;
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
  if (!res.ok) throw new ApiError(res.status, await res.json().catch(() => undefined));
  return res.json();
}

export async function del<T>(path: string): Promise<T> {
  const res = await fetch(`/api/${path}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new ApiError(res.status);
  return res.json();
}
