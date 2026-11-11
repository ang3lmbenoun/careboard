import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import { ApiError, api, post } from "./api";

type Row = { patient_id: number; birth_year: number; city: string | null; primary_condition: string | null; medications: number; readings: number };
type Issues = Record<string, string>;

const CONDITIONS = ["Type 2 diabetes", "Prediabetes", "Obesity"];
const PAYERS = ["Medicaid", "Medicare", "Dual", "Commercial"];
const CLASSES = ["GLP-1", "Insulin", "DPP-4", "Metformin"];
const INDICATIONS = ["Type 2 diabetes", "Prediabetes", "Weight management"];
const today = () => new Date().toISOString().slice(0, 10);

function Field({ label, error, children }: { label: string; error?: string; children: ReactNode }) {
  return (
    <label className="field">
      {label}
      {children}
      {error && <span className="entry-err" role="alert">{error}</span>}
    </label>
  );
}

// Turns a failed request into field messages and one general message.
function explain(x: unknown): { issues: Issues; message: string } {
  if (x instanceof ApiError) {
    const issues: Issues = {};
    for (const i of x.body?.issues ?? []) issues[i.field] = i.message;
    if (x.status === 400) return { issues, message: "Check the marked fields." };
    if (x.status === 409) return { issues, message: x.body?.error ?? "The demo limit is reached." };
    if (x.status === 403) return { issues, message: "Your role cannot do that." };
    if (x.status === 404) return { issues, message: "That patient is not in your clinic." };
    if (x.status === 429) return { issues, message: "Too many entries this hour. Try again later." };
  }
  return { issues: {}, message: "Could not save. Try again." };
}

export default function DataEntry() {
  const [rows, setRows] = useState<Row[]>([]);
  const [sel, setSel] = useState<number | null>(null);
  const [kind, setKind] = useState<"medication" | "reading">("medication");
  const [done, setDone] = useState("");

  const load = useCallback(async () => {
    try { setRows(await api<Row[]>("entry/patients")); } catch { /* the form still works */ }
  }, []);
  useEffect(() => { load(); }, [load]);

  // ---- new patient
  const [pf, setPf] = useState({ full_name: "", birth_date: "", city: "", primary_condition: "Type 2 diabetes", diagnosed_on: "", payer: "Medicaid" });
  const [pIssues, setPIssues] = useState<Issues>({});
  const [pMsg, setPMsg] = useState("");
  const [pBusy, setPBusy] = useState(false);
  async function addPatient(e: FormEvent) {
    e.preventDefault();
    setPBusy(true); setPMsg(""); setPIssues({}); setDone("");
    try {
      const body = { ...pf, city: pf.city || undefined, diagnosed_on: pf.diagnosed_on || undefined };
      const r = await post<{ patient_id: number }>("entry/patients", body);
      setPf({ ...pf, full_name: "", birth_date: "", city: "", diagnosed_on: "" });
      setDone(`Patient #${r.patient_id} added. The name is stored and cannot be read back.`);
      setSel(r.patient_id);
      await load();
    } catch (x) { const m = explain(x); setPIssues(m.issues); setPMsg(m.message); }
    finally { setPBusy(false); }
  }

  // ---- medication
  const [mf, setMf] = useState({ drug: "", drug_class: "Metformin", indication: "Type 2 diabetes", started_on: "", stopped_on: "", stop_reason: "" });
  const [mIssues, setMIssues] = useState<Issues>({});
  const [mMsg, setMMsg] = useState("");
  const [mBusy, setMBusy] = useState(false);
  async function addMed(e: FormEvent) {
    e.preventDefault();
    if (sel == null) return;
    setMBusy(true); setMMsg(""); setMIssues({}); setDone("");
    try {
      await post(`entry/patients/${sel}/medications`, { ...mf, stopped_on: mf.stopped_on || undefined, stop_reason: mf.stop_reason || undefined });
      setMf({ ...mf, drug: "", started_on: "", stopped_on: "", stop_reason: "" });
      setDone(`Medication added to patient #${sel}.`);
      await load();
    } catch (x) { const m = explain(x); setMIssues(m.issues); setMMsg(m.message); }
    finally { setMBusy(false); }
  }

  // ---- reading
  const [rf, setRf] = useState({ taken_on: "", a1c: "", weight_kg: "" });
  const [rIssues, setRIssues] = useState<Issues>({});
  const [rMsg, setRMsg] = useState("");
  const [rBusy, setRBusy] = useState(false);
  async function addReading(e: FormEvent) {
    e.preventDefault();
    if (sel == null) return;
    setRBusy(true); setRMsg(""); setRIssues({}); setDone("");
    try {
      await post(`entry/patients/${sel}/readings`, {
        taken_on: rf.taken_on,
        a1c: rf.a1c === "" ? undefined : Number(rf.a1c),
        weight_kg: rf.weight_kg === "" ? undefined : Number(rf.weight_kg),
      });
      setRf({ taken_on: "", a1c: "", weight_kg: "" });
      setDone(`Reading added to patient #${sel}.`);
      await load();
    } catch (x) { const m = explain(x); setRIssues(m.issues); setRMsg(m.message); }
    finally { setRBusy(false); }
  }

  return (
    <div className="entry">
      <p className="agent-note">
        You can add patients, medicines and measurements for your clinic. You cannot read names back, change an entry or see any
        analysis. Entries in this demo are synthetic and expire after six hours.
      </p>
      {done && <p className="entry-ok" role="status">{done}</p>}

      <div className="entry-grid">
        <section className="entry-card" aria-labelledby="en-new">
          <h3 id="en-new">1. Add a patient</h3>
          <form onSubmit={addPatient} noValidate>
            <Field label="Full name" error={pIssues.full_name}>
              <input value={pf.full_name} maxLength={80} autoComplete="off" onChange={(e) => setPf({ ...pf, full_name: e.target.value })} required />
            </Field>
            <Field label="Date of birth" error={pIssues.birth_date}>
              <input type="date" value={pf.birth_date} min="1900-01-01" max={today()} onChange={(e) => setPf({ ...pf, birth_date: e.target.value })} required />
            </Field>
            <Field label="City (optional)" error={pIssues.city}>
              <input value={pf.city} maxLength={60} onChange={(e) => setPf({ ...pf, city: e.target.value })} />
            </Field>
            <Field label="Main condition" error={pIssues.primary_condition}>
              <select value={pf.primary_condition} onChange={(e) => setPf({ ...pf, primary_condition: e.target.value })}>
                {CONDITIONS.map((c) => <option key={c}>{c}</option>)}
              </select>
            </Field>
            <Field label="Diagnosed on (optional)" error={pIssues.diagnosed_on}>
              <input type="date" value={pf.diagnosed_on} max={today()} onChange={(e) => setPf({ ...pf, diagnosed_on: e.target.value })} />
            </Field>
            <Field label="Coverage" error={pIssues.payer}>
              <select value={pf.payer} onChange={(e) => setPf({ ...pf, payer: e.target.value })}>
                {PAYERS.map((c) => <option key={c}>{c}</option>)}
              </select>
            </Field>
            {pMsg && <p className="entry-err" role="alert">{pMsg}</p>}
            <button className="primary" type="submit" disabled={pBusy || !pf.full_name || !pf.birth_date}>{pBusy ? "Saving..." : "Add patient"}</button>
          </form>
        </section>

        <section className="entry-card" aria-labelledby="en-add">
          <h3 id="en-add">2. Add to a patient</h3>
          <Field label="Patient">
            <select value={sel ?? ""} onChange={(e) => { setSel(e.target.value ? Number(e.target.value) : null); setDone(""); }}>
              <option value="">{rows.length ? "Choose a patient" : "No patients yet"}</option>
              {rows.map((r) => (
                <option key={r.patient_id} value={r.patient_id}>
                  #{r.patient_id} · born {r.birth_year} · {r.primary_condition ?? "condition unknown"} · {r.medications} med, {r.readings} reading
                </option>
              ))}
            </select>
          </Field>
          <div className="entry-seg" role="tablist" aria-label="What to add">
            <button type="button" role="tab" aria-selected={kind === "medication"} className={kind === "medication" ? "on" : ""} onClick={() => setKind("medication")}>Medication</button>
            <button type="button" role="tab" aria-selected={kind === "reading"} className={kind === "reading" ? "on" : ""} onClick={() => setKind("reading")}>Reading</button>
          </div>

          {kind === "medication" ? (
            <form onSubmit={addMed} noValidate>
              <Field label="Drug name" error={mIssues.drug}>
                <input value={mf.drug} maxLength={80} onChange={(e) => setMf({ ...mf, drug: e.target.value })} />
              </Field>
              <Field label="Drug class" error={mIssues.drug_class}>
                <select value={mf.drug_class} onChange={(e) => setMf({ ...mf, drug_class: e.target.value })}>{CLASSES.map((c) => <option key={c}>{c}</option>)}</select>
              </Field>
              <Field label="Reason for use" error={mIssues.indication}>
                <select value={mf.indication} onChange={(e) => setMf({ ...mf, indication: e.target.value })}>{INDICATIONS.map((c) => <option key={c}>{c}</option>)}</select>
              </Field>
              <Field label="Started on" error={mIssues.started_on}>
                <input type="date" value={mf.started_on} max={today()} onChange={(e) => setMf({ ...mf, started_on: e.target.value })} />
              </Field>
              <Field label="Stopped on (leave empty if still taking)" error={mIssues.stopped_on}>
                <input type="date" value={mf.stopped_on} max={today()} onChange={(e) => setMf({ ...mf, stopped_on: e.target.value })} />
              </Field>
              {mf.stopped_on && (
                <Field label="Why it stopped (optional)" error={mIssues.stop_reason}>
                  <input value={mf.stop_reason} maxLength={120} onChange={(e) => setMf({ ...mf, stop_reason: e.target.value })} />
                </Field>
              )}
              {mMsg && <p className="entry-err" role="alert">{mMsg}</p>}
              <button className="primary" type="submit" disabled={mBusy || sel == null || !mf.drug || !mf.started_on}>{mBusy ? "Saving..." : "Add medication"}</button>
            </form>
          ) : (
            <form onSubmit={addReading} noValidate>
              <Field label="Measured on" error={rIssues.taken_on}>
                <input type="date" value={rf.taken_on} max={today()} onChange={(e) => setRf({ ...rf, taken_on: e.target.value })} />
              </Field>
              <Field label="A1C, percent (3.0 to 20.0)" error={rIssues.a1c}>
                <input type="number" inputMode="decimal" step="0.1" min="3" max="20" value={rf.a1c} onChange={(e) => setRf({ ...rf, a1c: e.target.value })} />
              </Field>
              <Field label="Weight, kg (20 to 400)" error={rIssues.weight_kg}>
                <input type="number" inputMode="decimal" step="0.1" min="20" max="400" value={rf.weight_kg} onChange={(e) => setRf({ ...rf, weight_kg: e.target.value })} />
              </Field>
              {rMsg && <p className="entry-err" role="alert">{rMsg}</p>}
              <button className="primary" type="submit" disabled={rBusy || sel == null || !rf.taken_on || (rf.a1c === "" && rf.weight_kg === "")}>{rBusy ? "Saving..." : "Add reading"}</button>
            </form>
          )}
          {sel == null && <p className="agent-meta">Add a patient first, or choose one above.</p>}
        </section>
      </div>
    </div>
  );
}
