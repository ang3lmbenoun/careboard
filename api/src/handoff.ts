import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Express } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { withRole } from "./db.js";
import { agentsEnabled, resendSender, type Sender } from "./digest.js";

// Hand-off between a nurse and the clinicians of the same clinic: messages, record checks and medicine stock.
// Every query runs as the signed-in user's database role. The database decides who can read what; this file validates
// input and logs. Message text is shown to people as plain text and is never given to an agent.
type Deps = { auth: any; audit: (u: any, action: string, detail?: object) => Promise<void> };
type User = { sub: number; role: "admin" | "clinician" | "executive" | "nurse"; clinicId: number | null };

const admin = { role: "admin" as const, clinicId: null };
const OUTBOX = fileURLToPath(new URL("../outbox", import.meta.url));
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export const messageSchema = z.object({
  to_user: z.number().int().positive(),
  patient_id: z.number().int().positive().optional(),
  parent_id: z.number().int().positive().optional(),
  subject: z.string().trim().min(1, "Add a subject").max(120, "At most 120 characters"),
  body: z.string().trim().min(1, "Write a message").max(1500, "At most 1500 characters"),
});
export const checkSchema = z.object({
  patient_id: z.number().int().positive(),
  record_type: z.enum(["patient", "medication", "reading"]),
  record_id: z.number().int().positive(),
  status: z.enum(["verified", "needs_correction"]),
  note: z.string().trim().max(200, "At most 200 characters").optional(),
});
export const countSchema = z.object({
  item_id: z.number().int().positive(),
  quantity: z.number("Enter a number").int("Whole numbers only").min(0, "Cannot be negative").max(100000, "Too large"),
  note: z.string().trim().max(120, "At most 120 characters").optional(),
});

/** Send a message as this user. Used by the route and by the nurse agent after the nurse approves. */
export async function sendMessage(user: User, m: z.infer<typeof messageSchema>, byAgent = false): Promise<number> {
  return withRole(user, async (c) =>
    (await c.query(
      `INSERT INTO app.messages (to_user, patient_id, parent_id, subject, body, drafted_by_agent) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [m.to_user, m.patient_id ?? null, m.parent_id ?? null, m.subject, m.body, byAgent]
    )).rows[0].id as number
  );
}

/** The people this user may message (the other role in the same clinic). */
export async function contacts(user: User) {
  return withRole(user, async (c) => (await c.query("SELECT id, display_name, role FROM app.clinic_contacts() ORDER BY display_name")).rows as { id: number; display_name: string; role: string }[]);
}

// A short "you have a message" email. It holds no subject, no text and no patient number.
export async function notifyMessage(fromRole: string, toRole: string, clinic: number | null, o: { sender?: Sender } = {}): Promise<{ status: string }> {
  try {
    if (!(await agentsEnabled())) return { status: "blocked" };
    const to: string[] = await withRole(admin, async (c) => (await c.query("SELECT email FROM app.digest_recipients WHERE enabled ORDER BY email")).rows.map((r: any) => r.email));
    if (!to.length) return { status: "blocked" };
    const link = process.env.APP_URL ?? "https://careboard-1755.onrender.com";
    const subject = `CareBoard: new message for the ${toRole}`;
    const text = `A ${fromRole} in clinic ${clinic} sent a message to a ${toRole}.\nSign in to CareBoard and open Messages to read it.\n${link}\n\nSynthetic demo data. The message text is never sent by email.`;
    const html = `<!doctype html><html><body style="margin:0;background:#f5f0e1;padding:24px 12px;font-family:Segoe UI,Arial,sans-serif;color:#1b2a1f">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;margin:auto;background:#fffcf4;border:1px solid #e2d9c0;border-radius:14px;overflow:hidden">
<tr><td style="background:#2e5b3a;padding:16px 22px;color:#fffcf4"><div style="font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:#e8c478">CareBoard</div><div style="font-size:19px;font-weight:700;margin-top:4px">You have a new message</div></td></tr>
<tr><td style="padding:20px 22px"><p style="margin:0 0 14px;font-size:15px;line-height:1.5">A ${esc(fromRole)} in clinic ${esc(clinic)} sent a message to a ${esc(toRole)}.</p>
<a href="${esc(link)}" style="display:inline-block;background:#2e5b3a;color:#fffcf4;text-decoration:none;font-weight:600;font-size:14px;padding:10px 18px;border-radius:9px">Open Messages in CareBoard</a>
<p style="margin:16px 0 0;font-size:12px;color:#5a695d">Synthetic demo data. The message text is never sent by email.</p></td></tr></table></body></html>`;
    const sha = createHash("sha256").update(text).digest("hex");
    const live = !!(o.sender || process.env.RESEND_API_KEY);
    for (const t of to) {
      let status = "dry_run", reason: string | null = live ? null : "no email provider key";
      if (live) {
        try {
          const r = await (o.sender ?? resendSender)({ to: t, subject, text, html, idempotencyKey: `msg-${sha.slice(0, 12)}-${Date.now()}-${t}` });
          status = r.ok ? "sent" : "error"; if (!r.ok) reason = `provider returned ${r.status}`;
        } catch (e: any) { status = "error"; reason = String(e.message ?? "send failed").slice(0, 120); }
      } else {
        fs.mkdirSync(OUTBOX, { recursive: true });
        fs.writeFileSync(path.join(OUTBOX, `message-${Date.now()}.html`), html);
      }
      await withRole(admin, (c) => c.query(`INSERT INTO app.digest_log (kind, recipient, status, reason, content_sha256, body_chars) VALUES ('message', $1, $2, $3, $4, $5)`, [t, status, reason, sha, text.length]));
    }
    return { status: live ? "sent" : "dry_run" };
  } catch (e) { console.error("message notice failed", (e as Error).message); return { status: "error" }; }
}

const TODO_SQL = `
  WITH recs AS (
    SELECT 'patient'::text AS record_type, p.patient_id AS record_id, p.patient_id, p.created_at::date AS happened, 'Patient record: ' || p.primary_condition AS label
      FROM clinical.patients p WHERE p.entered_via = 'role_nurse'
    UNION ALL
    SELECT 'medication', m.med_id, m.patient_id, m.started_on, 'Medicine: ' || m.drug FROM clinical.patient_medications m WHERE m.entered_via = 'role_nurse'
    UNION ALL
    SELECT 'reading', r.reading_id, r.patient_id, r.taken_on, 'Reading' FROM clinical.patient_readings r WHERE r.entered_via = 'role_nurse'
  )
  SELECT r.record_type, r.record_id, r.patient_id, r.happened::text AS happened, r.label,
         k.status, k.note, k.checked_at
    FROM recs r
    LEFT JOIN LATERAL (SELECT status, note, checked_at FROM app.record_checks k WHERE k.record_type = r.record_type AND k.record_id = r.record_id ORDER BY k.id DESC LIMIT 1) k ON true
   ORDER BY (k.status IS NULL) DESC, (k.status = 'needs_correction') DESC, r.happened DESC NULLS LAST, r.record_id DESC
   LIMIT 80`;
const STOCK_SQL = `
  SELECT i.item_id, i.drug, i.drug_class, i.unit, i.reorder_level, s.quantity, s.counted_at, s.note,
         COALESCE(s.quantity < i.reorder_level, false) AS low
    FROM clinical.stock_items i
    LEFT JOIN LATERAL (SELECT quantity, counted_at, note FROM clinical.stock_counts c WHERE c.item_id = i.item_id ORDER BY c.id DESC LIMIT 1) s ON true
   ORDER BY low DESC, i.drug`;

/** What needs attention for this user. Used by Home and by the nurse helper. Counts and item names only. */
export async function handoffSummary(user: User) {
  return withRole(user, async (c) => {
    const unread = (await c.query("SELECT count(*)::int AS n FROM app.messages WHERE to_user = app.current_user_id() AND read_at IS NULL")).rows[0].n as number;
    const todo = (await c.query(TODO_SQL)).rows as { status: string | null; record_type: string; patient_id: number; label: string }[];
    const unverified = todo.filter((r) => r.status === null).length;
    const needsFix = todo.filter((r) => r.status === "needs_correction").length;
    const stock = (await c.query(STOCK_SQL)).rows as { drug: string; low: boolean; quantity: number | null; reorder_level: number; unit: string }[];
    const next = todo.filter((r) => r.status === null || r.status === "needs_correction").slice(0, 8).map((r) => ({ record_type: r.record_type, patient_id: r.patient_id, label: r.label, status: r.status }));
    return { unread, unverified, needs_correction: needsFix, next, low_stock: stock.filter((s) => s.low).map((s) => ({ drug: s.drug, quantity: s.quantity, reorder_level: s.reorder_level, unit: s.unit })) };
  });
}

export function registerHandoff(app: Express, { auth, audit }: Deps) {
  const safeAudit = async (u: any, action: string, detail: object = {}) => { try { await audit(u, action, detail); } catch (e) { console.error("audit failed", (e as Error).message); } };
  const staff = async (req: any, res: any, next: any) => {
    if (!["nurse", "clinician"].includes(req.user?.role) || req.user.clinicId == null) {
      await safeAudit(req.user, "access_denied", { route: req.path.replace(/^\//, "") });
      return res.status(403).json({ error: "forbidden" });
    }
    next();
  };
  const nurseOnly = (req: any, res: any, next: any) => (req.user.role === "nurse" ? next() : res.status(403).json({ error: "forbidden" }));
  const limiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: 120, standardHeaders: "draft-7", legacyHeaders: false });
  const bad = (res: any, e: z.ZodError) => res.status(400).json({ error: "Check the highlighted fields.", issues: e.issues.map((i) => ({ field: i.path.join("."), message: i.message })) });
  const fail = async (req: any, res: any, e: any, what: string) => {
    if (e.code === "42501" || e.code === "42P17") { await safeAudit(req.user, "access_denied", { route: what }); return res.status(403).json({ error: "forbidden" }); }
    if (e.code === "23514") return res.status(400).json({ error: "A value is outside the allowed range." });
    if (e.code === "23503") return res.status(404).json({ error: "Not found in your clinic." });
    console.error(e);
    res.status(500).json({ error: "server error" });
  };

  app.get("/handoff/summary", auth, staff, async (req: any, res) => { try { res.json(await handoffSummary(req.user)); } catch (e) { await fail(req, res, e, "handoff/summary"); } });
  app.get("/handoff/contacts", auth, staff, async (req: any, res) => { try { res.json(await contacts(req.user)); } catch (e) { await fail(req, res, e, "handoff/contacts"); } });

  app.get("/messages", auth, staff, async (req: any, res) => {
    try {
      const out = await withRole(req.user, async (c) => {
        const people = (await c.query("SELECT id, display_name, role FROM app.clinic_contacts()")).rows as any[];
        const name = new Map(people.map((p) => [p.id, p]));
        const rows = (await c.query(
          `SELECT id, from_user, to_user, patient_id, parent_id, subject, body, drafted_by_agent, created_at, read_at,
                  (from_user = app.current_user_id()) AS mine
             FROM app.messages ORDER BY id DESC LIMIT 100`
        )).rows;
        return rows.map((m: any) => {
          const other = name.get(m.mine ? m.to_user : m.from_user);
          return { ...m, other_name: other?.display_name ?? "Colleague", other_role: other?.role ?? null };
        });
      });
      res.json(out);
    } catch (e) { await fail(req, res, e, "messages"); }
  });

  app.post("/messages", auth, staff, limiter, async (req: any, res) => {
    const v = messageSchema.safeParse(req.body);
    if (!v.success) return bad(res, v.error);
    try {
      const people = await contacts(req.user);
      const to = people.find((p) => p.id === v.data.to_user);
      if (!to) { await safeAudit(req.user, "access_denied", { route: "messages" }); return res.status(403).json({ error: "forbidden" }); }
      const id = await sendMessage(req.user, v.data);
      await safeAudit(req.user, "message_send", { message_id: id, patient_id: v.data.patient_id ?? null }); // never the text
      const note = await notifyMessage(req.user.role, to.role, req.user.clinicId);
      res.status(201).json({ id, notice: note.status });
    } catch (e) { await fail(req, res, e, "messages"); }
  });

  app.post("/messages/:id/read", auth, staff, async (req: any, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: "bad id" });
    try {
      const n = await withRole(req.user, async (c) => (await c.query("UPDATE app.messages SET read_at = now() WHERE id = $1 AND to_user = app.current_user_id() AND read_at IS NULL", [id])).rowCount);
      res.json({ ok: true, changed: n });
    } catch (e) { await fail(req, res, e, "messages/read"); }
  });

  app.get("/checks/todo", auth, staff, async (req: any, res) => {
    try { res.json(await withRole(req.user, async (c) => (await c.query(TODO_SQL)).rows)); } catch (e) { await fail(req, res, e, "checks/todo"); }
  });
  app.post("/checks", auth, staff, limiter, async (req: any, res) => {
    const v = checkSchema.safeParse(req.body);
    if (!v.success) return bad(res, v.error);
    try {
      await withRole(req.user, (c) => c.query("INSERT INTO app.record_checks (patient_id, record_type, record_id, status, note) VALUES ($1,$2,$3,$4,$5)", [v.data.patient_id, v.data.record_type, v.data.record_id, v.data.status, v.data.note || null]));
      await safeAudit(req.user, "record_check", { patient_id: v.data.patient_id, record_type: v.data.record_type, record_id: v.data.record_id, status: v.data.status });
      res.status(201).json({ ok: true });
    } catch (e) { await fail(req, res, e, "checks"); }
  });

  app.get("/stock", auth, staff, async (req: any, res) => {
    try { res.json(await withRole(req.user, async (c) => (await c.query(STOCK_SQL)).rows)); } catch (e) { await fail(req, res, e, "stock"); }
  });
  app.post("/stock/count", auth, staff, nurseOnly, limiter, async (req: any, res) => {
    const v = countSchema.safeParse(req.body);
    if (!v.success) return bad(res, v.error);
    try {
      await withRole(req.user, (c) => c.query("INSERT INTO clinical.stock_counts (item_id, quantity, note) VALUES ($1,$2,$3)", [v.data.item_id, v.data.quantity, v.data.note || null]));
      await safeAudit(req.user, "stock_count", { item_id: v.data.item_id, quantity: v.data.quantity });
      res.status(201).json({ ok: true });
    } catch (e) { await fail(req, res, e, "stock/count"); }
  });
}
