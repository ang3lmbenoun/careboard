import assert from "node:assert/strict";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { generateClinicRows, resolveThrough } from "./generate_clinic_ops.ts";

// Usage (from the api folder):  npx tsx scripts/test_clinic_ops.ts
// Checks the synthetic clinic data generator. Needs no database and no internet.
const OLD_END = "2026-10-28"; // the end date the first committed file used

// 1. Extending the end date only appends rows: the earlier rows do not change.
const old = generateClinicRows(OLD_END).rows;
const later = generateClinicRows("2026-12-31").rows;
assert.equal(old.length, 4387, "header + 4,386 rows through 2026-10-28");
assert.ok(later.length > old.length, "a later end date adds rows");
assert.deepEqual(later.slice(0, old.length), old, "the rows before the old end date are unchanged");

// 2. The committed CSV still starts with exactly those rows (so reloading does not rewrite history).
const file = fileURLToPath(new URL("../../data/clinic_daily.csv", import.meta.url));
const committed = fs.readFileSync(file, "utf8").trimEnd().split(/\r?\n/);
assert.ok(committed.length >= old.length, "committed file is not shorter than the original");
assert.deepEqual(committed.slice(0, old.length), old, "committed file starts with the original 4,386 rows");

// 3. Shape: weekdays only, three departments per clinic per day, nothing after the end date.
const body = later.slice(1);
let last = "";
for (const line of body) {
  const date = line.slice(0, 10);
  const wd = new Date(date + "T00:00:00Z").getUTCDay();
  assert.ok(wd >= 1 && wd <= 5, `${date} is a weekend`);
  assert.ok(date <= "2026-12-31");
  last = date;
}
assert.equal(last, "2026-12-31", "2026-12-31 is a Thursday and has rows");
assert.equal(body.length % 6, 0, "6 rows (2 clinics x 3 departments) per open day");
for (const line of body) {
  const [, , , s, c, n] = line.split(",");
  assert.equal(Number(s), Number(c) + Number(n), `scheduled = completed + no_shows in ${line}`);
}

// 4. The end date: default is yesterday, bad or future dates are refused.
const now = new Date("2026-11-18T15:00:00Z");
assert.equal(resolveThrough(undefined, now), "2026-11-17");
assert.equal(resolveThrough("2026-11-18", now), "2026-11-18");
assert.throws(() => resolveThrough("2026-11-19", now), /after today/);
assert.throws(() => resolveThrough("2026-02-30", now), /real date/);
assert.throws(() => resolveThrough("11/17/2026", now), /YYYY-MM-DD/);
assert.throws(() => resolveThrough("2023-12-31", now), /2024-01-02/);

console.log(`ok: 4 groups; original ${old.length - 1} rows unchanged, committed file has ${committed.length - 1} rows`);
