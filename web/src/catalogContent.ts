export type Source = "public" | "synthetic";

export type TableInfo = {
  title: string;
  summary: string;
  source: Source;
  grain: string;
  usedOn: string;
};

// Plain-language descriptions of each dataset. Column descriptions come from the
// database comments (db/comments.sql), so they cannot drift from the schema.
export const TABLES: Record<string, TableInfo> = {
  "serving.medicaid_drug_quarterly": {
    title: "Medicaid diabetes drug spending, 2024",
    summary:
      "How much state Medicaid programs spent on four diabetes drug classes (GLP-1, insulin, DPP-4 and metformin), and how many prescriptions that paid for.",
    source: "public",
    grain: "One row per state, quarter and drug",
    usedOn: "Overview, Medicaid",
  },
  "serving.clinic_daily": {
    title: "Clinic appointments and no-shows",
    summary:
      "Daily appointment counts for two clinics, split by department: how many were scheduled, how many were completed and how many patients did not show up.",
    source: "synthetic",
    grain: "One row per day, clinic and department (weekdays only)",
    usedOn: "Overview, Operations",
  },
  "clinical.patients": {
    title: "Patients",
    summary:
      "Fake patient records that show how the database protects personal data. Clinicians see only patients of their own clinic, and no role can read names or birth dates.",
    source: "synthetic",
    grain: "One row per patient",
    usedOn: "Patients (clinician only)",
  },
  "clinical.patient_medications": {
    title: "Patient medications",
    summary: "Each medicine a synthetic patient has taken: which drug, which of the four classes it belongs to, why it was prescribed, and when it started and stopped.",
    source: "synthetic",
    grain: "One row per medication course",
    usedOn: "Patients (clinician only), Drug classes",
  },
  "clinical.patient_readings": {
    title: "Patient measurements",
    summary: "A1C (average blood sugar over about three months) and body weight for each synthetic patient, roughly every three months.",
    source: "synthetic",
    grain: "One row per patient and measurement date",
    usedOn: "Patients (clinician only)",
  },
  "app.users": {
    title: "App accounts",
    summary: "Sign-in accounts, their role and clinic. Password hashes are stored, never passwords.",
    source: "synthetic",
    grain: "One row per account",
    usedOn: "Sign-in",
  },
  "app.audit_log": {
    title: "Audit log",
    summary: "A record of every sign-in and every data view or question asked of Carry.",
    source: "synthetic",
    grain: "One row per action",
    usedOn: "Audit log (administrator only)",
  },
};

export const METRICS: { name: string; meaning: string; note: string }[] = [
  {
    name: "Medicaid spend",
    meaning: "Total dollars Medicaid reimbursed pharmacies for the drugs.",
    note: "Taken from the source field total_amount_reimbursed. 2024 only.",
  },
  {
    name: "Prescriptions reimbursed",
    meaning: "Number of prescriptions Medicaid paid for.",
    note: "The source hides very small counts, so totals can understate the real number.",
  },
  {
    name: "Appointments scheduled",
    meaning: "Appointments booked, before knowing whether the patient came.",
    note: "Synthetic clinic data.",
  },
  {
    name: "Completed appointments",
    meaning: "Scheduled appointments minus no-shows.",
    note: "Synthetic clinic data.",
  },
  {
    name: "No-show rate",
    meaning: "No-shows divided by scheduled appointments.",
    note: "For example, 86 no-shows out of 1,000 scheduled is 8.6%. Synthetic clinic data.",
  },
];

export function friendlyType(t: string): string {
  const x = t.toLowerCase();
  if (/^(smallint|integer|bigint|serial|bigserial)/.test(x)) return "Whole number";
  if (/^(numeric|decimal|real|double|float)/.test(x)) return "Decimal number";
  if (/^(text|character|varchar|char|citext)/.test(x)) return "Text";
  if (x === "date") return "Date";
  if (x.startsWith("timestamp")) return "Date and time";
  if (x === "boolean") return "Yes / No";
  return t;
}
