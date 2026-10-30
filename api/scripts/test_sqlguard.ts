import assert from "node:assert/strict";
import { validateSql, limitWrap } from "../src/sqlGuard.js";

const good = [
  "SELECT drug_class, SUM(spend) AS spend FROM serving.medicaid_drug_quarterly GROUP BY 1 ORDER BY 2 DESC LIMIT 5",
  "select department, sum(no_shows)::numeric / nullif(sum(scheduled), 0) as rate from serving.clinic_daily group by 1;",
  "WITH t AS (SELECT clinic_id, SUM(scheduled) s FROM serving.clinic_daily GROUP BY 1) SELECT * FROM t",
  "SELECT EXTRACT(YEAR FROM day) AS y, SUM(scheduled) FROM serving.clinic_daily GROUP BY 1",
  "SELECT SUM(spend) FROM serving.medicaid_drug_quarterly WHERE drug_class = 'GLP-1' AND state = 'it''s'",
  "SELECT 1 WHERE 'a;b--c /* x */ drop table' = 'x'",
  "SELECT department FROM serving.clinic_daily GROUP BY 1 ORDER BY 1 OFFSET 1 LIMIT 5",
  "SELECT MAX(updated_at_note) FROM serving.clinic_daily",
];

const bad: [string, string][] = [
  ["", "empty"],
  ["DROP TABLE serving.clinic_daily", "drop"],
  ["SELECT 1; DELETE FROM serving.clinic_daily", "two statements"],
  ["SELECT * FROM pg_roles", "pg_"],
  ["SELECT * FROM information_schema.tables", "information_schema"],
  ["SELECT 1 -- hi", "comment"],
  ["SELECT 1 /* hi */", "block comment"],
  ["SELECT pg_sleep(10)", "pg_sleep"],
  ["WITH x AS (DELETE FROM serving.clinic_daily RETURNING *) SELECT * FROM x", "data-modifying cte"],
  ["SELECT $$a$$", "dollar quote"],
  ["SELECT 1 INTO foo", "select into"],
  ["EXPLAIN SELECT 1", "explain"],
  ["SELECT set_config('a', 'b', false)", "set_config"],
  ["SELECT * FROM serving.clinic_daily FOR UPDATE", "for update"],
  ["SELECT E'\\x41'", "backslash"],
  ["SELECT 'unterminated", "open string"],
  ["UPDATE serving.clinic_daily SET scheduled = 0", "update"],
  ["(SELECT 1)", "must start with select"],
  ["SELECT U&'\\0041'", "unicode escape"],
  ["SELECT " + "x".repeat(2100), "too long"],
];

for (const sql of good) {
  const r = validateSql(sql);
  assert.equal(r.ok, true, `should accept: ${sql} -> ${r.ok ? "" : r.reason}`);
}
for (const [sql, label] of bad) {
  const r = validateSql(sql);
  assert.equal(r.ok, false, `should reject (${label}): ${sql.slice(0, 60)}`);
}
assert.equal(limitWrap("SELECT 1"), "SELECT * FROM (SELECT 1) AS carry_result LIMIT $1");
console.log(`sqlGuard: ${good.length} accepted, ${bad.length} rejected, all as expected`);
