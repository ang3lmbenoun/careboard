import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { withRole } from "./db.js";
import { agentsEnabled, resendSender, type Sender } from "./digest.js";

// Emails a follow-up call list after the person approved it. Rules:
//  - It sends only after approval, only to addresses on the allow list, and only while the kill switch is on.
//  - The patient numbers, tiers and A1C values come from the database under the signed-in user's role (row-level
//    security), never from the model's text. The model only supplies the short reason.
//  - Patient names and birth dates are never in the email. All patients are synthetic.
//  - An action is emailed once. Every attempt is logged (hash of the content, not the content).
// With no RESEND_API_KEY the email is written to api/outbox instead, so it can be inspected locally.

type User = { sub: number; role: "admin" | "clinician" | "executive" | "nurse"; clinicId: number | null };
const admin = { role: "admin" as const, clinicId: null };
const OUTBOX = fileURLToPath(new URL("../outbox", import.meta.url));
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export type FollowupRow = { patient_id: number; tier: string; latest_a1c: number | null; days_since_a1c: number | null; reasons: string[] | string | null };

const TIER_COLOR: Record<string, string> = { High: "#9b2c2c", Medium: "#8a6a12", Low: "#2e5b3a" };

export function renderFollowup(o: { reason: string; rows: FollowupRow[]; link: string; date: string; sender: string }) {
  const n = o.rows.length;
  const subject = `CareBoard: follow-up call list for ${n} patient${n === 1 ? "" : "s"}`;
  const reasons = (r: FollowupRow["reasons"]) => (Array.isArray(r) ? r.join("; ") : r ?? "");
  const text = [
    `Follow-up call list (${o.date})`,
    `Prepared by Tiffany for ${o.sender}. Approved by a person before sending.`,
    "",
    `Why: ${o.reason}`,
    "",
    ...o.rows.map((r) => `#${r.patient_id}  ${r.tier}  A1C ${r.latest_a1c ?? "n/a"}%  last A1C ${r.days_since_a1c ?? "n/a"} days ago  ${reasons(r.reasons)}`),
    "",
    `Open the list in CareBoard: ${o.link}`,
    "Synthetic demo data. No names or birth dates are included.",
  ].join("\n");
  const rowsHtml = o.rows
    .map(
      (r) => `<tr>
<td style="padding:10px 12px;border-top:1px solid #e2d9c0;font-weight:700;font-size:15px">#${esc(r.patient_id)}</td>
<td style="padding:10px 12px;border-top:1px solid #e2d9c0"><span style="display:inline-block;padding:2px 9px;border-radius:999px;background:${TIER_COLOR[r.tier] ?? "#2e5b3a"};color:#fff;font-size:12px;font-weight:600">${esc(r.tier)}</span></td>
<td style="padding:10px 12px;border-top:1px solid #e2d9c0;font-size:14px">${r.latest_a1c == null ? "n/a" : esc(r.latest_a1c) + "%"}<div style="color:#5a695d;font-size:12px">${r.days_since_a1c == null ? "" : esc(r.days_since_a1c) + " days ago"}</div></td>
<td style="padding:10px 12px;border-top:1px solid #e2d9c0;font-size:13px;color:#33433a">${esc(reasons(r.reasons))}</td></tr>`
    )
    .join("");
  const html = `<!doctype html><html><body style="margin:0;background:#f5f0e1;padding:24px 12px;font-family:Segoe UI,Arial,sans-serif;color:#1b2a1f">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:auto;background:#fffcf4;border:1px solid #e2d9c0;border-radius:14px;overflow:hidden">
<tr><td style="background:#2e5b3a;padding:18px 22px;color:#fffcf4"><div style="font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:#e8c478">CareBoard</div><div style="font-size:20px;font-weight:700;margin-top:4px">Follow-up call list</div></td></tr>
<tr><td style="padding:20px 22px 6px"><p style="margin:0 0 6px;font-size:14px;color:#5a695d">${esc(o.date)} &middot; prepared by Tiffany, approved by a person</p>
<p style="margin:0;font-size:15px;line-height:1.5"><b>Why these patients:</b> ${esc(o.reason)}</p></td></tr>
<tr><td style="padding:12px 22px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e2d9c0;border-radius:10px;overflow:hidden;background:#fff">
<tr style="background:#f0ead8;font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:#5a695d"><td style="padding:8px 12px">Patient</td><td style="padding:8px 12px">Risk</td><td style="padding:8px 12px">Latest A1C</td><td style="padding:8px 12px">Signals</td></tr>
${rowsHtml}</table></td></tr>
<tr><td style="padding:8px 22px 22px"><a href="${esc(o.link)}" style="display:inline-block;background:#2e5b3a;color:#fffcf4;text-decoration:none;font-weight:600;font-size:14px;padding:11px 20px;border-radius:9px">Open the list in CareBoard</a>
<p style="margin:16px 0 0;font-size:12px;color:#5a695d">Synthetic demo data. No names or birth dates are included in this email.</p></td></tr>
</table></body></html>`;
  return { subject, text, html };
}

export type EmailResult = { status: "sent" | "dry_run" | "blocked" | "error" | "skipped"; reason?: string; to?: string[] };

async function logMail(recipient: string, status: string, reason: string | undefined, sha: string, chars: number) {
  await withRole(admin, (c) =>
    c.query(`INSERT INTO app.digest_log (kind, recipient, status, reason, content_sha256, body_chars) VALUES ('followup', $1, $2, $3, $4, $5)`, [recipient, status, reason ?? null, sha, chars])
  );
}

export async function emailAction(user: User, actionId: number, o: { sender?: Sender; link?: string } = {}): Promise<EmailResult> {
  const { createHash } = await import("node:crypto");
  const act = await withRole(user, async (c) => (await c.query("SELECT id, type, status, payload, outcome FROM app.agent_actions WHERE id = $1", [actionId])).rows[0]);
  if (!act || !["followup_call_list", "email_followup_list"].includes(act.type)) return { status: "blocked", reason: "no such list" };
  if (act.status !== "approved") return { status: "blocked", reason: "approve the draft first" };
  if (act.outcome?.startsWith("emailed")) return { status: "skipped", reason: "already emailed" };
  const setOutcome = (v: string) => withRole(user, (c) => c.query("UPDATE app.agent_actions SET outcome = $2 WHERE id = $1", [actionId, v]));
  if (!(await agentsEnabled())) { await setOutcome("blocked: kill switch is off"); return { status: "blocked", reason: "agents are switched off" }; }

  const to: string[] = await withRole(admin, async (c) => (await c.query("SELECT email FROM app.digest_recipients WHERE enabled ORDER BY email")).rows.map((r: any) => r.email));
  if (!to.length) { await setOutcome("blocked: no allow-listed address"); return { status: "blocked", reason: "no address is on the allow list" }; }

  // Fresh numbers under the user's own role: only patients this user may see come back.
  const ids: number[] = act.payload.patient_ids;
  const rows: FollowupRow[] = await withRole(user, async (c) =>
    (await c.query(
      `SELECT patient_id, tier, latest_a1c::float8 AS latest_a1c, days_since_a1c, reasons FROM clinical.care_risk WHERE patient_id = ANY($1::int[]) ORDER BY points DESC, patient_id`, [ids]
    )).rows
  );
  if (!rows.length) { await setOutcome("blocked: no visible patients"); return { status: "blocked", reason: "no patients you can see" }; }

  const who = user.role === "clinician" ? `clinic ${user.clinicId}` : user.role;
  const mail = renderFollowup({
    reason: String(act.payload.reason ?? ""), rows, date: new Date().toISOString().slice(0, 10), sender: who,
    link: o.link ?? process.env.APP_URL ?? "https://careboard-1755.onrender.com",
  });
  const sha = createHash("sha256").update(mail.text).digest("hex");
  const live = !!(o.sender || process.env.RESEND_API_KEY);
  if (!live) {
    fs.mkdirSync(OUTBOX, { recursive: true });
    const stem = path.join(OUTBOX, `followup-${actionId}-${sha.slice(0, 8)}`);
    fs.writeFileSync(stem + ".txt", mail.text);
    fs.writeFileSync(stem + ".html", mail.html);
    for (const t of to) await logMail(t, "dry_run", "no email provider key", sha, mail.text.length);
    await setOutcome("dry run: no email provider key is set, saved to the outbox folder");
    return { status: "dry_run", to };
  }
  let errors = 0;
  for (const t of to) {
    try {
      const res = await (o.sender ?? resendSender)({ to: t, subject: mail.subject, text: mail.text, html: mail.html, idempotencyKey: `followup-${actionId}-${t}` });
      if (!res.ok) throw new Error(`provider returned ${res.status}`);
      await logMail(t, "sent", undefined, sha, mail.text.length);
    } catch (e: any) { errors++; await logMail(t, "error", String(e.message ?? "send failed").slice(0, 120), sha, mail.text.length); }
  }
  if (errors === to.length) { await setOutcome("error: the email provider refused it"); return { status: "error", reason: "the email provider refused it", to }; }
  await setOutcome(`emailed ${to.length} address${to.length === 1 ? "" : "es"}`);
  return { status: "sent", to };
}
