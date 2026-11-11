import { useData } from "./useData";

type Case = { id: string; category: string; who: string; blurb: string; question: string; passes: number; runs: number; why: string | null; answer: string; tools: string[] };
type Report = {
  generatedAt: string; model: string; cases: number; runs: number; repeat: number; passed: number; failed: number;
  latencyMs: { p50: number; p95: number }; tokensPerRun: { p50: number; p95: number }; totalCostUsd: number; costConfigured: boolean;
  categories: { key: string; title: string; passed: number; total: number }[];
  caseRows: Case[]; suites: { name: string; passed: number; failed: number }[];
};

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });

export default function Evaluation() {
  const { data, error } = useData<Report>("eval/latest");
  if (error) return <p className="state">{error.includes("No evaluation") ? "No evaluation results have been published yet." : error}</p>;
  if (!data) return <p className="state">Loading…</p>;
  const fails = data.caseRows.filter((c) => c.passes < c.runs);

  return (
    <>
      <div className="card">
        <p style={{ margin: 0, fontSize: 28, fontWeight: 700 }}>
          {data.passed} of {data.runs} runs passed
        </p>
        <p className="note" style={{ margin: "6px 0 0" }}>
          {data.cases} cases{data.repeat > 1 ? `, ${data.repeat} repeats each` : ""} on model {data.model}, run {when(data.generatedAt)}. Median run {(data.latencyMs.p50 / 1000).toFixed(1)} s, slowest 5% {(data.latencyMs.p95 / 1000).toFixed(1)} s, median {data.tokensPerRun.p50} tokens.
          {data.costConfigured ? ` Suite cost about $${data.totalCostUsd.toFixed(4)}.` : ""}
        </p>
      </div>

      <h3 style={{ margin: "24px 0 8px" }}>What each group proves</h3>
      <div className="table-wrap">
        <table className="data">
          <thead><tr><th>Group</th><th>Passed</th><th>Claim</th></tr></thead>
          <tbody>
            {data.categories.map((c) => (
              <tr key={c.key}>
                <td style={{ textTransform: "capitalize" }}>{c.key.replace(/_/g, " ")}</td>
                <td className="nowrap"><span className={`pill ${c.passed === c.total ? "pill-ok" : "pill-high"}`}>{c.passed}/{c.total}</span></td>
                <td>{c.title}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {fails.length > 0 && (
        <>
          <h3 style={{ margin: "24px 0 8px" }}>Failing cases</h3>
          <p className="note">Failures are published, not hidden. Each one names the check that failed.</p>
        </>
      )}

      <h3 style={{ margin: "24px 0 8px" }}>All cases</h3>
      <div className="table-wrap">
        <table className="data">
          <thead><tr><th>Case</th><th>Role</th><th>Test</th><th>Result</th></tr></thead>
          <tbody>
            {data.caseRows.map((c) => (
              <tr key={c.id}>
                <td><code>{c.id}</code></td>
                <td style={{ textTransform: "capitalize" }}>{c.who}</td>
                <td>
                  <details>
                    <summary>{c.blurb}</summary>
                    <p className="note"><strong>Asked:</strong> {c.question}</p>
                    <p className="note"><strong>Tools used:</strong> {c.tools.length ? c.tools.join(", ") : "none"}</p>
                    <p className="note"><strong>Answer:</strong> {c.answer}</p>
                  </details>
                </td>
                <td className="nowrap">
                  <span className={`pill ${c.passes === c.runs ? "pill-ok" : "pill-high"}`}>{c.passes === c.runs ? "pass" : `fail ${c.passes}/${c.runs}`}</span>
                  {c.why && c.passes < c.runs && <div className="note">{c.why}</div>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {data.suites.length > 0 && (
        <>
          <h3 style={{ margin: "24px 0 8px" }}>Automated test suites</h3>
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>Suite</th><th>Passed</th><th>Failed</th></tr></thead>
              <tbody>{data.suites.map((s) => <tr key={s.name}><td><code>{s.name}</code></td><td>{s.failed < 0 ? "did not complete" : s.passed}</td><td>{s.failed < 0 ? "" : s.failed}</td></tr>)}</tbody>
            </table>
          </div>
        </>
      )}

      <p className="note" style={{ marginTop: 16 }}>
        Limits: a hosted model at temperature 0 is not fully repeatable, the cases cover the failure modes I thought of, and the data is synthetic.
      </p>
    </>
  );
}
