import { CLASS_ORDER, DRUGS } from "./drugContent";
import { useData } from "./useData";

type ClassRow = { label: string; prescriptions: number; spend: number };
type DrugRow = { label: string; prescriptions: number; spend: number };
type Count = { drug_class: string; indication: string; patients: number };

const money = (v: number) =>
  v >= 1e9 ? `$${(v / 1e9).toFixed(1)}B` : v >= 1e6 ? `$${(v / 1e6).toFixed(0)}M` : `$${Math.round(v / 1e3)}K`;

export const clsKey = (c: string) => "cls-" + c.toLowerCase().replace(/[^a-z0-9]/g, "");

function TopDrugs({ cls }: { cls: string }) {
  const { data } = useData<DrugRow[]>(`medicaid/breakdown?by=drug&class=${encodeURIComponent(cls)}`);
  if (!data) return <p className="note">Loading drugs…</p>;
  if (!data.length) return <p className="note">No Medicaid rows for this class.</p>;
  return (
    <ul className="druglist">
      {data.slice(0, 4).map((d) => (
        <li key={d.label}>
          <span>{d.label}</span>
          <span className="num">{money(d.spend)}</span>
        </li>
      ))}
    </ul>
  );
}

function Cards({ counts }: { counts: Count[] | null }) {
  const classes = useData<ClassRow[]>("medicaid/breakdown?by=class");
  const total = classes.data?.reduce((a, r) => a + r.spend, 0) ?? 0;
  return (
    <>
      <div className="druggrid">
        {CLASS_ORDER.map((key) => {
          const info = DRUGS[key];
          const row = classes.data?.find((r) => r.label === key);
          const mine = counts?.filter((c) => c.drug_class === key) ?? [];
          const mineTotal = mine.reduce((a, c) => a + c.patients, 0);
          return (
            <section key={key} className="drugcard">
              <h3>
                <span className={"chip " + clsKey(key)}>{key}</span> {info.name}
              </h3>
              <p className="tag">{info.tagline}</p>
              <dl className="facts compact">
                <dt>How it works</dt>
                <dd>{info.how}</dd>
                <dt>Used for</dt>
                <dd>{info.usedFor}</dd>
                <dt>Form</dt>
                <dd>{info.form}</dd>
                <dt>Examples</dt>
                <dd>{info.examples}</dd>
              </dl>
              <div className="drugstats">
                <div>
                  <p className="kpi-label">Medicaid spend, 2024</p>
                  <p className="big">{row ? money(row.spend) : "…"}</p>
                  <p className="note">{row && total ? `${((row.spend / total) * 100).toFixed(1)}% of the four classes` : ""}</p>
                  <TopDrugs cls={key} />
                </div>
                {counts && (
                  <div>
                    <p className="kpi-label">Your synthetic patients now taking it</p>
                    <p className="big">{mineTotal}</p>
                    {mine.map((c) => (
                      <p className="note" key={c.indication}>{c.patients} for {c.indication.toLowerCase()}</p>
                    ))}
                  </div>
                )}
              </div>
            </section>
          );
        })}
      </div>
      <p className="note">
        General background, not medical advice. Spending comes from public CMS Medicaid data for 2024. Patient counts
        use synthetic patients. A fifth diabetes class, SGLT2 inhibitors, is not included in this app.
      </p>
    </>
  );
}

function ClinicianCards() {
  const { data } = useData<Count[]>("patients/classes");
  return <Cards counts={data} />;
}

export default function Drugs({ role }: { role: string }) {
  return role === "clinician" ? <ClinicianCards /> : <Cards counts={null} />;
}
