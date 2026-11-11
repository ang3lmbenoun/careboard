import { GROUP_TITLE, PATH_STEPS, SIGNALS, SYNTHETIC_NOTES, TAG_TEXT, type SignalGroup } from "./signalContent";

type Role = "admin" | "clinician" | "executive" | "nurse";
type Go = "medicaid" | "riskspend" | "riskops" | "riskcomp" | "riskcare" | "patients" | "audit" | "catalog" | "payers";

const ORDER: SignalGroup[] = ["executive", "clinician", "admin"];

export default function Signals({ role, onOpen }: { role: Role; onOpen: (to: Go) => void }) {
  return (
    <div className="sg">
      <section className="sg-path" aria-labelledby="sg-path" data-tour="sg-path">
        <h2 id="sg-path">The path every number takes</h2>
        <ol>
          {PATH_STEPS.map((p, i) => (
            <li key={p.t}>
              <span className="sg-n">{i + 1}</span>
              <strong>{p.t}</strong>
              <span>{p.d}</span>
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="sg-tags">
        <h2 id="sg-tags">What the tags mean</h2>
        <ul className="sg-tags">
          {(Object.keys(TAG_TEXT) as (keyof typeof TAG_TEXT)[]).map((k) => (
            <li key={k}>
              <span className={`tag tag-${k}`}>{TAG_TEXT[k].name}</span>
              <span>{TAG_TEXT[k].means}</span>
            </li>
          ))}
        </ul>
      </section>

      {ORDER.map((g) => (
        <section key={g} aria-labelledby={`sg-${g}`}>
          <h2 id={`sg-${g}`}>
            {GROUP_TITLE[g]}
            {g === role && <span className="sg-you">your Overview</span>}
          </h2>
          <div className="sg-grid">
            {SIGNALS.filter((s) => s.group === g).map((s) => (
              <article className="sg-card" key={s.id}>
                <header>
                  <h3>{s.label}</h3>
                  <span className={`tag tag-${s.tag}`}>{TAG_TEXT[s.tag].name}</span>
                </header>
                <dl>
                  <dt>Where it comes from</dt>
                  <dd>{s.source}</dd>
                  <dt>How it is calculated</dt>
                  <dd>{s.how}</dd>
                  <dt>Keep in mind</dt>
                  <dd>{s.caution}</dd>
                </dl>
                {s.page && <button className="sg-link" onClick={() => onOpen(s.page!)}>Open the detail</button>}
              </article>
            ))}
          </div>
        </section>
      ))}

      <section className="sg-honest" aria-labelledby="sg-honest">
        <h2 id="sg-honest">Why the synthetic signals show what they show</h2>
        <p>I wrote the generators, so these findings are properties of my assumptions. They are not discoveries.</p>
        <ul>{SYNTHETIC_NOTES.map((n) => <li key={n}>{n}</li>)}</ul>
        <p className="sg-foot">
          Column-level definitions and sensitivity labels are in the <button className="sg-link" onClick={() => onOpen("catalog")}>Data catalog</button>.
        </p>
      </section>
    </div>
  );
}
