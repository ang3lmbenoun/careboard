import type { Express } from "express";
import { withRole, type Role } from "./db.js";

// Risk and compliance routes. Every route is role-checked here AND by the database (grants, row-level security,
// and functions that return only counts). Denied requests are written to the audit log.
type Claims = { sub: number; role: Role; clinicId: number | null };
type Deps = {
  auth: (req: any, res: any, next: any) => void;
  audit: (u: Claims, action: string, detail?: object) => Promise<void>;
};

export function registerRisk(app: Express, { auth, audit }: Deps) {
  const safeAudit = async (u: Claims, action: string, detail: object = {}) => {
    try {
      await audit(u, action, detail);
    } catch (e) {
      console.error("audit failed", (e as Error).message);
    }
  };
  const deny = async (req: any, res: any, route: string) => {
    await safeAudit(req.user, "access_denied", { route });
    return res.status(403).json({ error: "forbidden" });
  };
  const fail = (res: any, e: any) => {
    if (e?.code === "42501") return res.status(403).json({ error: "forbidden" });
    console.error(e);
    return res.status(500).json({ error: "server error" });
  };

  const bandOf = (score: number) => (score >= 15 ? "Critical" : score >= 10 ? "High" : score >= 5 ? "Medium" : "Low");

  // Risk register and control map: admin and executive.
  app.get("/risk/register", auth, async (req: any, res) => {
    if (req.user.role === "clinician") return deny(req, res, "risk/register");
    try {
      const { risks, controls } = await withRole(req.user, async (c) => ({
        risks: (await c.query("SELECT * FROM app.risk_register ORDER BY risk_id")).rows,
        controls: (await c.query("SELECT * FROM app.control_map ORDER BY control_id")).rows,
      }));
      await safeAudit(req.user, "view_risk_register", { risks: risks.length, controls: controls.length });
      res.json({
        risks: risks.map((r: any) => ({ ...r, inherent_band: bandOf(r.inherent_score), residual_band: bandOf(r.residual_score) })),
        controls,
      });
    } catch (e) {
      fail(res, e);
    }
  });

  // Live security metrics, data health and control tests: admin only.
  app.get("/risk/security", auth, async (req: any, res) => {
    if (req.user.role !== "admin") return deny(req, res, "risk/security");
    try {
      const out = await withRole(req.user, async (c) => {
        const totals = (
          await c.query(
            `SELECT
               count(*) FILTER (WHERE action = 'login')::int                       AS sign_ins,
               count(*) FILTER (WHERE action = 'login_failed')::int                AS failed_sign_ins,
               count(*) FILTER (WHERE action = 'access_denied')::int               AS denied_requests,
               count(*) FILTER (WHERE action = 'assistant_query')::int             AS carry_questions,
               count(*) FILTER (WHERE action = 'assistant_query' AND detail->>'mode' = 'refuse')::int AS carry_refusals,
               count(*) FILTER (WHERE action IN ('view_patient', 'view_patients', 'view_patient_classes', 'view_care_risk'))::int AS patient_data_views,
               count(*) FILTER (WHERE action = 'add_patient')::int                 AS patients_added,
               count(*) FILTER (WHERE action = 'remove_patient')::int              AS patients_removed,
               count(DISTINCT user_id)::int                                        AS active_users
             FROM app.audit_log WHERE at > now() - interval '30 days'`
          )
        ).rows[0];
        const daily = (
          await c.query(
            `SELECT d::date::text AS day,
                    count(a.id) FILTER (WHERE a.action = 'login')::int         AS sign_ins,
                    count(a.id) FILTER (WHERE a.action = 'login_failed')::int  AS failed,
                    count(a.id) FILTER (WHERE a.action = 'access_denied')::int AS denied
             FROM generate_series(current_date - 13, current_date, '1 day') d
             LEFT JOIN app.audit_log a ON a.at >= d AND a.at < d + interval '1 day'
             GROUP BY d ORDER BY d`
          )
        ).rows;
        const events = (
          await c.query(
            `SELECT a.at, a.action, a.role, a.detail
             FROM app.audit_log a WHERE a.action IN ('login_failed', 'access_denied')
             ORDER BY a.id DESC LIMIT 8`
          )
        ).rows;
        const inventory = (await c.query("SELECT * FROM app.data_inventory()")).rows;
        const checks = (await c.query("SELECT * FROM app.data_checks()")).rows;
        const tests = (await c.query("SELECT * FROM app.control_tests()")).rows;
        return { totals, daily, events, inventory, checks, tests };
      });
      await safeAudit(req.user, "view_security", {});
      res.json(out);
    } catch (e) {
      fail(res, e);
    }
  });

  // Care risk worklist: a clinician sees their own clinic (row-level security applies through the view).
  app.get("/risk/care", auth, async (req: any, res) => {
    if (req.user.role !== "clinician") return deny(req, res, "risk/care");
    try {
      const rows = await withRole(req.user, async (c) =>
        (
          await c.query(
            `SELECT patient_id, clinic_id, primary_condition, demo_created, latest_a1c::float8 AS latest_a1c,
                    latest_a1c_on::text AS latest_a1c_on, days_since_a1c, a1c_change::float8 AS a1c_change,
                    points, tier, reasons
             FROM clinical.care_risk
             ORDER BY points DESC, latest_a1c DESC NULLS LAST, patient_id`
          )
        ).rows
      );
      await safeAudit(req.user, "view_care_risk", { rows: rows.length });
      res.json(rows);
    } catch (e) {
      fail(res, e);
    }
  });

  // Care risk counts for executives and admins: small cells are hidden inside the database function.
  app.get("/risk/care/summary", auth, async (req: any, res) => {
    if (req.user.role === "clinician") return deny(req, res, "risk/care/summary");
    try {
      const rows = await withRole(req.user, async (c) => (await c.query("SELECT * FROM app.care_risk_summary(5)")).rows);
      await safeAudit(req.user, "view_care_risk_summary", { groups: rows.length });
      res.json({ min_cell: 5, rows });
    } catch (e) {
      fail(res, e);
    }
  });

  // Operational risk: counts only. Revenue at risk is computed in the browser from an adjustable visit value.
  app.get("/risk/ops", auth, async (req: any, res) => {
    try {
      const out = await withRole(req.user, async (c) => {
        const asOf = (await c.query("SELECT max(day)::text AS as_of FROM serving.clinic_daily")).rows[0]?.as_of ?? null;
        const windows = (
          await c.query(
            `WITH b AS (SELECT max(day) AS as_of FROM serving.clinic_daily)
             SELECT c.clinic_id, c.department,
               SUM(c.scheduled) FILTER (WHERE c.day > b.as_of - 365)::int AS s12,
               SUM(c.no_shows)  FILTER (WHERE c.day > b.as_of - 365)::int AS n12,
               SUM(c.scheduled) FILTER (WHERE c.day > b.as_of - 730 AND c.day <= b.as_of - 365)::int AS sp12,
               SUM(c.no_shows)  FILTER (WHERE c.day > b.as_of - 730 AND c.day <= b.as_of - 365)::int AS np12,
               SUM(c.scheduled) FILTER (WHERE c.day > b.as_of - 90)::int AS s90,
               SUM(c.no_shows)  FILTER (WHERE c.day > b.as_of - 90)::int AS n90,
               SUM(c.scheduled) FILTER (WHERE c.day > b.as_of - 180 AND c.day <= b.as_of - 90)::int AS sp90,
               SUM(c.no_shows)  FILTER (WHERE c.day > b.as_of - 180 AND c.day <= b.as_of - 90)::int AS np90
             FROM serving.clinic_daily c CROSS JOIN b
             GROUP BY c.clinic_id, c.department ORDER BY c.clinic_id, c.department`
          )
        ).rows;
        const weekdays = (
          await c.query(
            `WITH b AS (SELECT max(day) AS as_of FROM serving.clinic_daily)
             SELECT extract(isodow FROM c.day)::int AS dow, c.department,
                    SUM(c.scheduled)::int AS scheduled, SUM(c.no_shows)::int AS no_shows
             FROM serving.clinic_daily c CROSS JOIN b WHERE c.day > b.as_of - 365
             GROUP BY 1, 2 ORDER BY 1, 2`
          )
        ).rows;
        const months = (
          await c.query(
            `WITH b AS (SELECT max(day) AS as_of FROM serving.clinic_daily)
             SELECT to_char(date_trunc('month', c.day), 'YYYY-MM') AS month, c.department,
                    SUM(c.scheduled)::int AS scheduled, SUM(c.no_shows)::int AS no_shows
             FROM serving.clinic_daily c CROSS JOIN b WHERE c.day > b.as_of - 730
             GROUP BY 1, 2 ORDER BY 1, 2`
          )
        ).rows;
        return { as_of: asOf, windows, weekdays, months };
      });
      await safeAudit(req.user, "view_ops_risk", {});
      res.json(out);
    } catch (e) {
      fail(res, e);
    }
  });

  // Financial exposure: Medicaid spend shares and price-versus-volume. Scenarios are computed in the browser.
  app.get("/risk/spend", auth, async (req: any, res) => {
    try {
      const out = await withRole(req.user, async (c) => {
        const classes = (
          await c.query(
            `SELECT drug_class AS label, SUM(prescriptions)::float8 AS prescriptions, SUM(spend)::float8 AS spend
             FROM serving.medicaid_drug_quarterly GROUP BY 1 ORDER BY spend DESC`
          )
        ).rows;
        const quarters = (
          await c.query(
            `SELECT year, quarter, drug_class, SUM(prescriptions)::float8 AS prescriptions, SUM(spend)::float8 AS spend
             FROM serving.medicaid_drug_quarterly GROUP BY 1, 2, 3 ORDER BY 1, 2, 3`
          )
        ).rows;
        const drugs = (
          await c.query(
            `SELECT drug AS label, drug_class, SUM(prescriptions)::float8 AS prescriptions, SUM(spend)::float8 AS spend
             FROM serving.medicaid_drug_quarterly GROUP BY 1, 2 ORDER BY spend DESC LIMIT 10`
          )
        ).rows;
        const states = (
          await c.query(
            `SELECT state AS label, SUM(spend)::float8 AS spend
             FROM serving.medicaid_drug_quarterly GROUP BY 1 ORDER BY spend DESC`
          )
        ).rows;
        return { classes, quarters, drugs, states };
      });
      await safeAudit(req.user, "view_spend_risk", {});
      res.json(out);
    } catch (e) {
      fail(res, e);
    }
  });
}
