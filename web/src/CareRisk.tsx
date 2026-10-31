import { useState } from "react";
import Avatar from "./Avatar";
import { useData } from "./useData";
import { Pill, Section, Stat, type Tone } from "./riskUi";

type Row = {
  patient_id: number;
  clinic_id: number;
  primary_condition: string;
  demo_created: boolean;
  latest_a1c: number | null;
  latest_a1c_on: string | null;
  days_since_a1c: number | null;
  a1c_change: number | null;
  points: number;
  tier: "High" | "Medium" | "Low";
  reasons: string[] | null;
};
type Summary = {
  min_cell: number;
  rows: { clinic_id: number; condition: string; patients: number | null; elevated: number | null; low: number | null; patients_hidden: boolean; bands_hidden: boolean }[];
};

const TONE: Record<Row["tier"], Tone> = { High: "high", Medium: "med", Low: "low" };

const RULES: [string, string, string][] = [
  ["Latest A1C 9% or higher", "3", "Common quality measures treat A1C above 9% as poor control."],
  ["Latest A1C 8% to 8.9%", "1", "Above many individual targets."],
  ["A1C rose by 0.5 points or more", "1", "Moving the wrong way since the last reading."],
  ["No A1C for 6 months (diabetes) or 12 months (other)", "2", "Overdue for monitoring. No reading on record also scores 2."],
  ["GLP-1 stopped in the last 6 months, none active", "1", "Continuity of treatment."],
  ["Started insulin in the last year", "1", "Often marks disease progression."],
  ["Weight up 3% or more over about 6 months", "1", "Trend over the last three readings."],
];

function Rules() {
  return (
    <details className="how">
      <summary>How the score works</summary>
      <p className="note">
        Points are added up. <strong>3 or more is High, 2 is Medium, 0 or 1 is Low.</strong> Every flag shows its reason, so a clinician can disagree with it.
        These thresholds are illustrative. They are modeled loosely on common diabetes quality measures and are not clinical guidance.
      </p>
      <div className="table-wrap">
        <table className="data mini-data">
          <thead><tr><th>Rule</th><th className="num">Points</th><th>Why</th></tr></thead>
          <tbody>
            {RULES.map(([rule, pts, why]) => (
              <tr key={rule}><td>{rule}</td><td className="num">{pts}</td><td className="sub-td">{why}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="note">
        Why rules and not machine learning: with a few dozen synthetic patients a model would only memorize the data, and a rule can be explained to the person it affects.
      </p>
    </details>
  );
}

const SYNTHETIC =
  "All patients are synthetic. The seed data was shaped to include some poorly controlled patients and some who stopped coming in, so the rules have something to find. These are not findings about real people.";

function Worklist() {
  const { data, error } = useData<Row[]>("risk/care");
  const [tier, setTier] = useState<"All" | Row["tier"]>("All");
  if (error) return <p className="state err">{error}</p>;
  if (!data) return <p className="state">Loading…</p>;
  const n = (t: Row["tier"]) => data.filter((r) => r.tier === t).length;
  const rows = data.filter((r) => tier === "All" || r.tier === tier);
  return (
    <>
      <div className="sc-grid">
        <Stat label="Patients in your clinic" value={String(data.length)} note="Includes demo patients you added" />
        <Stat label="High" value={String(n("High"))} note="3 or more points" tone={n("High") ? "warn" : "ok"} />
        <Stat label="Medium" value={String(n("Medium"))} note="2 points" />
        <Stat label="Low" value={String(n("Low"))} note="0 or 1 point" />
      </div>
      <Rules />
      <Section title="Worklist" lede="Highest risk first. Patients are shown by number only; the database hides names and birth dates from your role.">
        <div className="seg" role="group" aria-label="Filter by tier">
          {(["All", "High", "Medium", "Low"] as const).map((t) => (
            <button key={t} className={tier === t ? "on" : ""} onClick={() => setTier(t)}>{t}</button>
          ))}
        </div>
        <div className="table-wrap">
          <table className="data work">
            <thead>
              <tr><th>Patient</th><th>Risk</th><th>Why</th><th className="num">Latest A1C</th></tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.patient_id}>
                  <td>
                    <div className="who">
                      <Avatar id={r.patient_id} size={34} />
                      <div>
                        <strong>Patient #{r.patient_id}</strong>
                        <div className="sub">{r.primary_condition}{r.demo_created ? " · added in demo" : ""}</div>
                      </div>
                    </div>
                  </td>
                  <td><Pill tone={TONE[r.tier]}>{r.tier}</Pill><div className="sub">{r.points} point{r.points === 1 ? "" : "s"}</div></td>
                  <td className="sub-td">{r.reasons && r.reasons.length ? r.reasons.join(" · ") : "No flags"}</td>
                  <td className="num">
                    {r.latest_a1c === null ? "None" : `${r.latest_a1c.toFixed(1)}%`}
                    {r.latest_a1c_on && <div className="sub">{r.latest_a1c_on}</div>}
                  </td>
                </tr>
              ))}
              {!rows.length && <tr><td colSpan={4} className="state">No patients in this tier.</td></tr>}
            </tbody>
          </table>
        </div>
        <p className="note">{SYNTHETIC}</p>
      </Section>
    </>
  );
}

function Counts({ role }: { role: string }) {
  const { data, error } = useData<Summary>("risk/care/summary");
  if (error) return <p className="state err">{error}</p>;
  if (!data) return <p className="state">Loading…</p>;
  const hidden = data.rows.filter((r) => r.bands_hidden).length;
  return (
    <>
      <div className="callout">
        <strong>What {role === "executive" ? "an executive" : "an administrator"} can see.</strong> Not individual patients: only counts, and only where a group is large enough that nobody can be picked out.
        Any group with fewer than {data.min_cell} patients shows nothing, and when one risk band is under {data.min_cell} both bands are hidden, so the missing number cannot be worked out by subtraction.
        The rule runs inside the database, not in this page.
      </div>
      <Section title="Elevated-risk patients by clinic and condition" lede={`${hidden} of ${data.rows.length} groups have a hidden value. Elevated means Medium or High.`}>
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr><th>Clinic</th><th>Condition</th><th className="num">Patients</th><th className="num">Elevated risk</th><th className="num">Low risk</th></tr>
            </thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={`${r.clinic_id}-${r.condition}`}>
                  <td>Clinic {r.clinic_id}</td>
                  <td>{r.condition}</td>
                  <td className="num">{r.patients ?? <span className="hid">fewer than {data.min_cell}</span>}</td>
                  <td className="num">{r.elevated ?? <span className="hid">hidden</span>}</td>
                  <td className="num">{r.low ?? <span className="hid">hidden</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="note">Counts cover the original synthetic patients only, so patients added in the demo cannot change what executives see. {SYNTHETIC}</p>
      </Section>
      <Rules />
    </>
  );
}

export default function CareRisk({ role }: { role: string }) {
  return role === "clinician" ? <Worklist /> : <Counts role={role} />;
}
