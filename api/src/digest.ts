import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Express } from "express";
import rateLimit from "express-rate-limit";
import { HumanMessage, SystemMessage, type AIMessage } from "@langchain/core/messages";
import { ChatOpenAI } from "@langchain/openai";
import { withRole } from "./db.js";
import type { Chat } from "./agent.js";

// Executive email digest. The numbers come from the database, each query running as the role that is allowed to read
// it (executive for spend and no shows, admin for control status and agent activity). A model may write a two sentence
// summary, but only from the numbers below, and the text is discarded if it contains any number that is not in the data.
// Nothing leaves unless the address is on the allow list, the kill switch is on, and the body holds no patient numbers.

const exec = { role: "executive" as const, clinicId: null };
const admin = { role: "admin" as const, clinicId: null };

export type Digest = {
  date: string;
  spend: { program: string; total: string; top_class: string; top_share: string }[];
  no_show: { clinic: number; scheduled: string; no_shows: string; rate: string }[];
  controls: { passing: number; total: number; failing: string[] };
  data_checks: { passing: number; total: number; failing: string[] };
  agent: { runs_24h: number; finished: number; blocked_or_stopped: number; errors: number };
  approvals: { pending: number; approved_7d: number; rejected_7d: number };
  security: { denied_24h: number; failed_logins_24h: number };
};

const money = (n: number) => (n >= 1e9 ? `$${(n / 1e9).toFixed(2)} billion` : n >= 1e6 ? `$${(n / 1e6).toFixed(1)} million` : `$${Math.round(n).toLocaleString("en-US")}`);
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

export async function collectDigest(now = new Date()): Promise<Digest> {
  const spend = await withRole(exec, async (c) =>
    (await c.query(`
      SELECT program, SUM(spend)::float8 AS total, (array_agg(drug_class ORDER BY spend DESC))[1] AS top_class,
             (MAX(spend) / NULLIF(SUM(spend), 0))::float8 AS top_share
      FROM (
        SELECT 'Medicaid' AS program, drug_class, SUM(spend) AS spend FROM serving.medicaid_drug_quarterly
          WHERE year = (SELECT max(year) FROM serving.medicaid_drug_quarterly) GROUP BY drug_class
        UNION ALL
        SELECT 'Medicare', drug_class, SUM(spend) FROM serving.medicare_part_d_annual
          WHERE year = (SELECT max(year) FROM serving.medicare_part_d_annual) GROUP BY drug_class
      ) s GROUP BY program ORDER BY program`)).rows
  );
  const noShow = await withRole(exec, async (c) =>
    (await c.query(`
      SELECT clinic_id, SUM(scheduled)::int AS scheduled, SUM(no_shows)::int AS no_shows,
             (SUM(no_shows)::numeric / NULLIF(SUM(scheduled), 0))::float8 AS rate
        FROM serving.clinic_daily GROUP BY clinic_id ORDER BY clinic_id`)).rows
  );
  const adminData = await withRole(admin, async (c) => ({
    tests: (await c.query("SELECT name, status FROM app.control_tests()")).rows,
    checks: (await c.query("SELECT name, status FROM app.data_checks()")).rows,
    runs: (await c.query(`SELECT status, count(*)::int AS n FROM app.agent_runs WHERE started_at > now() - interval '24 hours' GROUP BY status`)).rows,
    actions: (await c.query(`SELECT status, count(*)::int AS n FROM app.agent_actions
                             WHERE status = 'pending' OR created_at > now() - interval '7 days' GROUP BY status`)).rows,
    sec: (await c.query(`SELECT action, count(*)::int AS n FROM app.audit_log
                         WHERE action IN ('access_denied', 'login_failed') AND at > now() - interval '24 hours' GROUP BY action`)).rows,
  }));
  const n = (rows: any[], key: string, v: string) => rows.find((r) => r[key] === v)?.n ?? 0;
  const total = (rows: any[]) => rows.reduce((a, r) => a + r.n, 0);
  return {
    date: now.toLocaleDateString("en-CA", { timeZone: "America/Chicago" }),
    spend: spend.map((r: any) => ({ program: r.program, total: money(r.total), top_class: r.top_class, top_share: pct(r.top_share) })),
    no_show: noShow.map((r: any) => ({ clinic: r.clinic_id, scheduled: r.scheduled.toLocaleString("en-US"), no_shows: r.no_shows.toLocaleString("en-US"), rate: pct(r.rate) })),
    controls: { passing: adminData.tests.filter((t: any) => t.status === "pass").length, total: adminData.tests.length, failing: adminData.tests.filter((t: any) => t.status !== "pass").map((t: any) => t.name) },
    data_checks: { passing: adminData.checks.filter((t: any) => t.status === "pass").length, total: adminData.checks.length, failing: adminData.checks.filter((t: any) => t.status !== "pass").map((t: any) => t.name) },
    agent: {
      runs_24h: total(adminData.runs), finished: n(adminData.runs, "status", "finished"),
      blocked_or_stopped: n(adminData.runs, "status", "blocked") + n(adminData.runs, "status", "stopped"), errors: n(adminData.runs, "status", "error"),
    },
    approvals: { pending: n(adminData.actions, "status", "pending"), approved_7d: n(adminData.actions, "status", "approved"), rejected_7d: n(adminData.actions, "status", "rejected") },
    security: { denied_24h: n(adminData.sec, "action", "access_denied"), failed_logins_24h: n(adminData.sec, "action", "login_failed") },
  };
}

// ---- text

export function renderText(d: Digest, narrative: string | null): string {
  const L: string[] = [`CareBoard summary for ${d.date}`, ""];
  if (narrative) L.push(narrative, "");
  L.push("Drug spend, latest year");
  for (const s of d.spend) L.push(`- ${s.program}: ${s.total}. Largest class: ${s.top_class} (${s.top_share}).`);
  L.push("", "No show rate by clinic");
  for (const c of d.no_show) L.push(`- Clinic ${c.clinic}: ${c.rate} (${c.no_shows} of ${c.scheduled} visits)`);
  L.push("", "Controls");
  L.push(`- Control tests passing: ${d.controls.passing} of ${d.controls.total}${d.controls.failing.length ? ". Failing: " + d.controls.failing.join("; ") : ""}`);
  L.push(`- Data checks passing: ${d.data_checks.passing} of ${d.data_checks.total}${d.data_checks.failing.length ? ". Failing: " + d.data_checks.failing.join("; ") : ""}`);
  L.push("", "Agent activity, last 24 hours");
  L.push(`- Runs: ${d.agent.runs_24h} (finished ${d.agent.finished}, blocked or stopped ${d.agent.blocked_or_stopped}, errors ${d.agent.errors})`);
  L.push(`- Actions waiting for approval: ${d.approvals.pending}. Last 7 days: ${d.approvals.approved_7d} approved, ${d.approvals.rejected_7d} rejected.`);
  L.push(`- Access attempts refused: ${d.security.denied_24h}. Failed sign ins: ${d.security.failed_logins_24h}.`);
  const url = process.env.APP_URL;
  L.push("", url ? `Open CareBoard: ${url}` : "Open CareBoard to see more.", "", "This message holds totals only. It never contains patient names, numbers or records. Synthetic demo data.");
  return L.join("\n");
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
export function renderHtml(text: string): string {
  const blocks = text.split("\n\n").map((b) => {
    const lines = b.split("\n");
    if (lines.every((l) => l.startsWith("- "))) return `<ul>${lines.map((l) => `<li>${esc(l.slice(2))}</li>`).join("")}</ul>`;
    if (lines.length > 1 && lines.slice(1).every((l) => l.startsWith("- "))) return `<h3 style="margin:18px 0 6px;font-size:15px">${esc(lines[0])}</h3><ul>${lines.slice(1).map((l) => `<li>${esc(l.slice(2))}</li>`).join("")}</ul>`;
    return `<p>${esc(b).replace(/\n/g, "<br>")}</p>`;
  });
  return `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;line-height:1.5;color:#17261f">${blocks.join("")}</div>`;
}

// ---- guards

/** The body may not hold patient numbers or anything shaped like one. Throws when it does. */
export function assertAggregateOnly(body: string) {
  const bad = [/#\s?\d/, /\bpatient\s*(id|number|no\.?|#)?\s*:?\s*\d/i, /\bpatients?\s+(#|numbers?)\b/i, /\bMRN\b/i, /\bborn\b|\bbirth\s*date\b|\bdate of birth\b|\bDOB\b/i];
  for (const re of bad) if (re.test(body)) throw new Error("digest body is not aggregate only");
}

// Time windows such as "24 hours" or "7 days" are wording, not data, so they are ignored by the check.
const WINDOW = /\b\d+[- ]?(hours?|days?|weeks?|months?)\b/gi;
const numbersIn = (s: string) => (s.replace(WINDOW, " ").match(/\d[\d,]*\.?\d*/g) ?? []).map((x) => x.replace(/,/g, "").replace(/\.$/, ""));
/** Numbers in the text that do not appear in the data. Empty means the text is grounded. */
export function ungroundedNumbers(narrative: string, d: Digest): string[] {
  const allowed = new Set(numbersIn(JSON.stringify(d)));
  return [...new Set(numbersIn(narrative).filter((x) => !allowed.has(x)))];
}
export const isGrounded = (narrative: string, d: Digest) => ungroundedNumbers(narrative, d).length === 0;

const NARRATE_PROMPT =
  "You write two plain sentences summarizing a daily operations digest for an executive. Use only numbers that appear in the JSON, " +
  "copied exactly as written. Do not mention time periods, advice, causes, patient details or any other number. No markdown.";

export async function narrate(d: Digest, model: Chat): Promise<{ text: string | null; status: "model" | "rejected"; reason?: string }> {
  try {
    const r = await model.invoke([new SystemMessage(NARRATE_PROMPT), new HumanMessage(JSON.stringify(d))]);
    const text = String(typeof r.content === "string" ? r.content : "").trim();
    if (!text) return { text: null, status: "rejected", reason: "summary discarded: empty reply" };
    if (text.length > 600) return { text: null, status: "rejected", reason: "summary discarded: too long" };
    const extra = ungroundedNumbers(text, d);
    if (extra.length) return { text: null, status: "rejected", reason: `summary discarded: numbers not in data: ${extra.slice(0, 5).join(", ")}` };
    try { assertAggregateOnly(text); } catch { return { text: null, status: "rejected", reason: "summary discarded: looked like patient data" }; }
    return { text, status: "model" };
  } catch {
    return { text: null, status: "rejected", reason: "summary discarded: model call failed" };
  }
}

/** A plain model with no tools, used only to word the summary. Returns null when no key is configured. */
export function plainModel(): Chat | null {
  const key = process.env.GROQ_API_KEY;
  if (!key) return null;
  const llm = new ChatOpenAI({
    model: process.env.GROQ_MODEL ?? "llama-3.3-70b-versatile",
    apiKey: key, temperature: 0, maxTokens: 200,
    configuration: { baseURL: process.env.GROQ_BASE_URL ?? "https://api.groq.com/openai/v1" },
  });
  return { invoke: (m) => llm.invoke(m) as Promise<AIMessage> };
}

// ---- sending

export type Sender = (msg: { to: string; subject: string; text: string; html: string; idempotencyKey: string }) => Promise<{ ok: boolean; status: number }>;

export const resendSender: Sender = async (m) => {
  const key = process.env.RESEND_API_KEY!;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "Idempotency-Key": m.idempotencyKey },
    body: JSON.stringify({ from: process.env.DIGEST_FROM ?? "CareBoard <onboarding@resend.dev>", to: [m.to], subject: m.subject, text: m.text, html: m.html }),
  });
  return { ok: res.ok, status: res.status };
};

const OUTBOX = fileURLToPath(new URL("../outbox", import.meta.url));

export type SendResult = { recipient: string; status: "sent" | "dry_run" | "blocked" | "error" | "skipped"; reason?: string; narrative?: string };

async function log(r: { recipient: string; status: string; reason?: string; narrative?: string; sha?: string; chars?: number }) {
  await withRole(admin, (c) =>
    c.query(
      `INSERT INTO app.digest_log (recipient, status, reason, narrative, content_sha256, body_chars) VALUES ($1,$2,$3,$4,$5,$6)`,
      [r.recipient, r.status, r.reason ?? null, r.narrative ?? null, r.sha ?? null, r.chars ?? null]
    )
  );
}

export async function agentsEnabled(): Promise<boolean> {
  const v = await withRole(admin, async (c) => (await c.query("SELECT value FROM app.agent_settings WHERE key = 'agents_enabled'")).rows[0]?.value);
  return v === "true";
}

export type SendOptions = { dryRun?: boolean; to?: string; model?: Chat | null; sender?: Sender; now?: Date };

export async function sendDigest(o: SendOptions = {}): Promise<SendResult[]> {
  const recipients: string[] = await withRole(admin, async (c) => (await c.query("SELECT email FROM app.digest_recipients WHERE enabled ORDER BY email")).rows.map((r: any) => r.email));
  const targets = o.to ? [o.to.toLowerCase()] : recipients;
  const out: SendResult[] = [];

  if (!(await agentsEnabled())) {
    for (const t of targets) { await log({ recipient: t, status: "blocked", reason: "kill switch is off" }); out.push({ recipient: t, status: "blocked", reason: "kill switch is off" }); }
    return out;
  }
  if (targets.length === 0) return out;

  const data = await collectDigest(o.now);
  let narrative: string | null = null;
  let narrativeStatus: "model" | "template" | "rejected" = "template";
  let narrativeReason: string | undefined;
  if (o.model) { const n = await narrate(data, o.model); narrative = n.text; narrativeStatus = n.status; narrativeReason = n.reason; }
  const text = renderText(data, narrative);
  const html = renderHtml(text);
  const sha = createHash("sha256").update(text).digest("hex");
  const subject = `CareBoard summary, ${data.date}`;

  try { assertAggregateOnly(text); } catch (e: any) {
    for (const t of targets) await log({ recipient: t, status: "blocked", reason: e.message, narrative: narrativeStatus, sha });
    return targets.map((t) => ({ recipient: t, status: "blocked" as const, reason: e.message }));
  }

  const live = !o.dryRun && !!(o.sender || process.env.RESEND_API_KEY);
  for (const t of targets) {
    if (!recipients.includes(t)) {
      await log({ recipient: t, status: "blocked", reason: "not on the allow list" });
      out.push({ recipient: t, status: "blocked", reason: "not on the allow list" });
      continue;
    }
    if (!live) {
      fs.mkdirSync(OUTBOX, { recursive: true });
      const stem = path.join(OUTBOX, `digest-${data.date}-${sha.slice(0, 8)}`);
      fs.writeFileSync(stem + ".txt", text);
      fs.writeFileSync(stem + ".html", html);
      await log({ recipient: t, status: "dry_run", reason: narrativeReason, narrative: narrativeStatus, sha, chars: text.length });
      out.push({ recipient: t, status: "dry_run", narrative: narrativeStatus });
      continue;
    }
    const already = await withRole(admin, async (c) =>
      (await c.query("SELECT 1 FROM app.digest_log WHERE recipient = $1 AND kind = 'executive' AND digest_date = current_date AND status = 'sent'", [t])).rowCount
    );
    if (already) { out.push({ recipient: t, status: "skipped", reason: "already sent today" }); continue; }
    try {
      const res = await (o.sender ?? resendSender)({ to: t, subject, text, html, idempotencyKey: `digest-${data.date}-${t}` });
      if (!res.ok) throw new Error(`provider returned ${res.status}`);
      await log({ recipient: t, status: "sent", reason: narrativeReason, narrative: narrativeStatus, sha, chars: text.length });
      out.push({ recipient: t, status: "sent", narrative: narrativeStatus });
    } catch (e: any) {
      const reason = String(e.message ?? "send failed").slice(0, 120);
      await log({ recipient: t, status: "error", reason, narrative: narrativeStatus, sha, chars: text.length });
      out.push({ recipient: t, status: "error", reason });
    }
  }
  return out;
}

// ---- routes (admin only)

type Deps = { auth: any; audit: (u: any, action: string, detail?: object) => Promise<void> };

export function registerDigest(app: Express, { auth, audit }: Deps) {
  const adminOnly = (req: any, res: any, next: any) => (req.user.role === "admin" ? next() : res.status(403).json({ error: "forbidden" }));
  const limiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: 12, standardHeaders: "draft-7", legacyHeaders: false });
  const model = () => { try { return plainModel(); } catch { return null; } };

  app.get("/digest/log", auth, adminOnly, async (req: any, res) => {
    const rows = await withRole(req.user, async (c) => ({
      log: (await c.query("SELECT id, at, recipient, status, reason, narrative FROM app.digest_log ORDER BY id DESC LIMIT 15")).rows,
      recipients: (await c.query("SELECT email, enabled FROM app.digest_recipients ORDER BY email")).rows,
    }));
    res.json(rows);
  });

  app.post("/digest/preview", auth, adminOnly, limiter, async (req: any, res) => {
    try {
      const data = await collectDigest();
      const m = model();
      const n = m ? await narrate(data, m) : { text: null, status: "template" as const };
      const text = renderText(data, n.text);
      assertAggregateOnly(text);
      await audit(req.user, "digest_preview", {});
      res.json({ text, narrative: n.status });
    } catch (e) { console.error(e); res.status(500).json({ error: "server error" }); }
  });

  app.post("/digest/send", auth, adminOnly, limiter, async (req: any, res) => {
    try {
      const results = await sendDigest({ model: model() });
      await audit(req.user, "digest_send", { results: results.map((r) => r.status) });
      res.json({ results, live: !!process.env.RESEND_API_KEY });
    } catch (e) { console.error(e); res.status(500).json({ error: "server error" }); }
  });
}
