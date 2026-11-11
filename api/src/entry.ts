import type { Express } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { withRole } from "./db.js";

// Data entry for the nurse role. Every query runs as role_nurse, so the database decides what is allowed:
// add only, own clinic only, demo patients only, names never readable. This file adds input validation and logging.
type Deps = { auth: any; audit: (u: any, action: string, detail?: object) => Promise<void> };

const today = () => new Date().toISOString().slice(0, 10);
const date = z.string("Enter a date").regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD").refine((d) => !Number.isNaN(Date.parse(d)) && new Date(d).toISOString().slice(0, 10) === d, "Not a real date");
const pastDate = date.refine((d) => d <= today(), "Date cannot be in the future");
const text = (min: number, max: number) =>
  z.string().trim().min(min, min === 1 ? "Required" : `At least ${min} characters`).max(max, `At most ${max} characters`);
const NAME = /^[\p{L}][\p{L} .'-]*$/u;
const SAFE = /^[\p{L}\p{N} .,'()/+-]*$/u;

export const CONDITIONS = ["Type 2 diabetes", "Prediabetes", "Obesity"] as const;
export const PAYERS = ["Medicaid", "Medicare", "Dual", "Commercial"] as const;
export const CLASSES = ["GLP-1", "Insulin", "DPP-4", "Metformin"] as const;
export const INDICATIONS = ["Type 2 diabetes", "Prediabetes", "Weight management"] as const;

export const patientSchema = z.object({
  full_name: z.string("Required").trim().min(2, "Enter the full name").max(80, "At most 80 characters").regex(NAME, "Letters, spaces, hyphens and apostrophes only"),
  birth_date: pastDate.refine((d) => d >= "1900-01-01", "Too early"),
  city: text(1, 60).regex(SAFE, "Unsupported characters").optional(),
  primary_condition: z.enum(CONDITIONS, "Choose from the list"),
  diagnosed_on: pastDate.optional(),
  payer: z.enum(PAYERS, "Choose from the list"),
}).refine((v) => !v.diagnosed_on || v.diagnosed_on >= v.birth_date, { message: "Diagnosis cannot be before birth", path: ["diagnosed_on"] });

export const medicationSchema = z.object({
  drug: text(2, 80).regex(SAFE, "Unsupported characters"),
  drug_class: z.enum(CLASSES, "Choose from the list"),
  indication: z.enum(INDICATIONS, "Choose from the list"),
  started_on: pastDate,
  stopped_on: pastDate.optional(),
  stop_reason: text(1, 120).regex(SAFE, "Unsupported characters").optional(),
}).refine((v) => !v.stopped_on || v.stopped_on >= v.started_on, { message: "Stop date is before start date", path: ["stopped_on"] })
  .refine((v) => !v.stop_reason || !!v.stopped_on, { message: "A stop reason needs a stop date", path: ["stop_reason"] });

export const readingSchema = z.object({
  taken_on: pastDate,
  a1c: z.number("Enter a number").min(3, "A1C is between 3.0 and 20.0").max(20, "A1C is between 3.0 and 20.0").multipleOf(0.1, "Use one decimal place").optional(),
  weight_kg: z.number("Enter a number").min(20, "Weight is between 20 and 400 kg").max(400, "Weight is between 20 and 400 kg").multipleOf(0.1, "Use one decimal place").optional(),
}).refine((v) => v.a1c !== undefined || v.weight_kg !== undefined, { message: "Enter an A1C, a weight, or both", path: ["a1c"] });

const pid = (v: unknown) => (Number.isInteger(Number(v)) && Number(v) > 0 ? Number(v) : null);
const issues = (e: z.ZodError) => e.issues.map((i) => ({ field: i.path.join("."), message: i.message }));

export function registerEntry(app: Express, { auth, audit }: Deps) {
  const safeAudit = async (u: any, action: string, detail: object = {}) => {
    try { await audit(u, action, detail); } catch (e) { console.error("audit failed", (e as Error).message); }
  };
  const nurseOnly = async (req: any, res: any, next: any) => {
    if (req.user.role !== "nurse" || req.user.clinicId == null) {
      await safeAudit(req.user, "access_denied", { route: req.path.replace(/^\//, "") });
      return res.status(403).json({ error: "forbidden" });
    }
    next();
  };
  const limiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: 120, standardHeaders: "draft-7", legacyHeaders: false });

  // A rejected write is mapped to a plain status. Details of the database error are never returned.
  const fail = async (req: any, res: any, e: any, what: string) => {
    if (e.code === "CB001") return res.status(409).json({ error: "The demo limit for this clinic is reached. Older demo patients expire after six hours." });
    if (e.code === "42501") {
      await safeAudit(req.user, "access_denied", { route: what });
      return res.status(403).json({ error: "forbidden" });
    }
    if (e.code === "23514") return res.status(400).json({ error: "A value is outside the allowed range." });
    if (e.code === "23503") return res.status(404).json({ error: "Patient not found in your clinic." });
    console.error(e);
    res.status(500).json({ error: "server error" });
  };

  // The clinic's patients, newest first. No names, birth dates or coverage: the role cannot read them.
  app.get("/entry/patients", auth, nurseOnly, async (req: any, res) => {
    try {
      const rows = await withRole(req.user, async (c) =>
        (await c.query(
          `SELECT p.patient_id, p.birth_year, p.city, p.primary_condition, p.demo_created, p.created_at,
                  (SELECT count(*)::int FROM clinical.patient_medications m WHERE m.patient_id = p.patient_id) AS medications,
                  (SELECT count(*)::int FROM clinical.patient_readings r WHERE r.patient_id = p.patient_id) AS readings
           FROM clinical.patients p ORDER BY p.created_at DESC, p.patient_id DESC LIMIT 30`
        )).rows
      );
      res.json(rows);
    } catch (e) { await fail(req, res, e, "entry/patients"); }
  });

  app.post("/entry/patients", auth, nurseOnly, limiter, async (req: any, res) => {
    const v = patientSchema.safeParse(req.body);
    if (!v.success) return res.status(400).json({ error: "Check the highlighted fields.", issues: issues(v.error) });
    const d = v.data;
    try {
      const id = await withRole(req.user, async (c) => {
        await c.query("SELECT clinical.expire_demo_patients()");
        return (await c.query(
          `INSERT INTO clinical.patients (clinic_id, full_name, birth_date, city, primary_condition, diagnosed_on, demo_created, payer)
           VALUES ($1, $2, $3, $4, $5, $6, true, $7) RETURNING patient_id`,
          [req.user.clinicId, d.full_name, d.birth_date, d.city ?? null, d.primary_condition, d.diagnosed_on ?? null, d.payer]
        )).rows[0].patient_id as number;
      });
      await safeAudit(req.user, "entry_add_patient", { patient_id: id }); // never the name
      res.status(201).json({ patient_id: id });
    } catch (e) { await fail(req, res, e, "entry/patients"); }
  });

  app.post("/entry/patients/:id/medications", auth, nurseOnly, limiter, async (req: any, res) => {
    const id = pid(req.params.id);
    if (!id) return res.status(400).json({ error: "bad id" });
    const v = medicationSchema.safeParse(req.body);
    if (!v.success) return res.status(400).json({ error: "Check the highlighted fields.", issues: issues(v.error) });
    const d = v.data;
    try {
      const mid = await withRole(req.user, async (c) =>
        (await c.query(
          `INSERT INTO clinical.patient_medications (patient_id, drug, drug_class, indication, started_on, stopped_on, stop_reason)
           VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING med_id`,
          [id, d.drug, d.drug_class, d.indication, d.started_on, d.stopped_on ?? null, d.stop_reason ?? null]
        )).rows[0].med_id as number
      );
      await safeAudit(req.user, "entry_add_medication", { patient_id: id, med_id: mid });
      res.status(201).json({ med_id: mid });
    } catch (e) { await fail(req, res, e, "entry/medications"); }
  });

  app.post("/entry/patients/:id/readings", auth, nurseOnly, limiter, async (req: any, res) => {
    const id = pid(req.params.id);
    if (!id) return res.status(400).json({ error: "bad id" });
    const v = readingSchema.safeParse(req.body);
    if (!v.success) return res.status(400).json({ error: "Check the highlighted fields.", issues: issues(v.error) });
    const d = v.data;
    try {
      const rid = await withRole(req.user, async (c) =>
        (await c.query(
          `INSERT INTO clinical.patient_readings (patient_id, taken_on, a1c, weight_kg) VALUES ($1, $2, $3, $4) RETURNING reading_id`,
          [id, d.taken_on, d.a1c ?? null, d.weight_kg ?? null]
        )).rows[0].reading_id as number
      );
      await safeAudit(req.user, "entry_add_reading", { patient_id: id, reading_id: rid });
      res.status(201).json({ reading_id: rid });
    } catch (e) { await fail(req, res, e, "entry/readings"); }
  });
}
