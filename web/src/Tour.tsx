import { useEffect, useState } from "react";

type Role = "admin" | "clinician" | "executive";

const ROLE_LABEL: Record<Role, string> = { admin: "Administrator", clinician: "Clinician", executive: "Executive" };

const SEES: Record<Role, { can: string[]; cannot: string[] }> = {
  executive: {
    can: ["Medicaid drug spending and clinic appointment trends", "The data catalog, to see what every number means"],
    cannot: ["Individual patient records", "The audit log"],
  },
  clinician: {
    can: ["Patients of your own clinic, without names or birth dates", "Medicaid and clinic appointment data"],
    cannot: ["Patients of other clinics", "Names and birth dates (hidden from every role)", "The audit log"],
  },
  admin: {
    can: ["The audit log of every sign-in, page view and Carry question", "Medicaid and clinic appointment data"],
    cannot: ["Patient records (the database denies them to this role)"],
  },
};

const START: Record<Role, string> = {
  executive: "Open Overview for the headline numbers, then Medicaid to see which drug classes cost the most.",
  clinician: "Open Operations to see no-shows by department, then Patients to see what your role is allowed to read.",
  admin: "Open the Audit log to see activity recorded by the database, then the Data catalog to see what each role is denied.",
};

export default function Tour({ role, onClose }: { role: Role; onClose: () => void }) {
  const [step, setStep] = useState(0);
  const last = 2;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const sees = SEES[role];
  return (
    <div className="tour-scrim" onClick={onClose}>
      <div className="tour" role="dialog" aria-modal="true" aria-labelledby="tour-title" onClick={(e) => e.stopPropagation()}>
        <p className="tour-step">Step {step + 1} of {last + 1}</p>
        {step === 0 && (
          <>
            <h2 id="tour-title">Welcome to CareBoard</h2>
            <p>
              CareBoard is a health analytics demo. It combines real public Medicaid spending on diabetes drugs with
              synthetic clinic data, and shows how a database can decide who sees what.
            </p>
            <p>
              There are three roles: administrator, clinician and executive. You are signed in as{" "}
              <strong>{ROLE_LABEL[role]}</strong>. Sign out and try another role to compare.
            </p>
          </>
        )}
        {step === 1 && (
          <>
            <h2 id="tour-title">What you can see</h2>
            <p className="tour-h">You can open</p>
            <ul>{sees.can.map((t) => <li key={t}>{t}</li>)}</ul>
            <p className="tour-h">You cannot open</p>
            <ul className="no">{sees.cannot.map((t) => <li key={t}>{t}</li>)}</ul>
            <p className="note">These limits are enforced by the database, not by hiding buttons.</p>
          </>
        )}
        {step === 2 && (
          <>
            <h2 id="tour-title">Where to start</h2>
            <p>{START[role]}</p>
            <p>
              Not sure what a number means? Open the <strong>Data catalog</strong> for plain definitions, or select{" "}
              <strong>Ask Carry</strong> in the corner and ask in your own words.
            </p>
          </>
        )}
        <div className="tour-foot">
          <div className="dots" aria-hidden="true">
            {[0, 1, 2].map((i) => <span key={i} className={i === step ? "on" : ""} />)}
          </div>
          <div className="tour-btns">
            {step < last && <button onClick={onClose}>Skip</button>}
            {step > 0 && <button onClick={() => setStep(step - 1)}>Back</button>}
            {step < last ? (
              <button className="primary" onClick={() => setStep(step + 1)}>Next</button>
            ) : (
              <button className="primary" onClick={onClose}>Get started</button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
