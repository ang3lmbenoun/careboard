// First line of defence for model-written SQL. The real guard is the database:
// role_assistant can only SELECT from two summary tables, inside a READ ONLY transaction with a timeout.
// This check rejects anything that is not a single, plain SELECT before it reaches the database.

export type GuardResult = { ok: true; sql: string } | { ok: false; reason: string };

const MAX_LEN = 2000;

const DENY_WORDS =
  /\b(insert|update|delete|drop|alter|create|truncate|grant|revoke|copy|call|execute|vacuum|set|reset|show|listen|notify|lock|refresh|comment|into)\b/i;

const DENY_FRAGMENTS = /(pg_|information_schema|current_setting|set_config|lo_import|lo_export|dblink)/i;

const fail = (reason: string): GuardResult => ({ ok: false, reason });

export function validateSql(input: string): GuardResult {
  let sql = input.trim();
  if (!sql) return fail("The query is empty.");
  if (sql.length > MAX_LEN) return fail("The query is too long.");
  sql = sql.replace(/;\s*$/, "").trim();
  if (/[\\$]/.test(sql)) return fail("Backslashes and dollar signs are not allowed.");

  // Blank out single-quoted string literals so words inside them are not mistaken for SQL.
  let code = "";
  let i = 0;
  while (i < sql.length) {
    if (sql[i] === "'") {
      let j = i + 1;
      for (;;) {
        if (j >= sql.length) return fail("A string in the query is not closed.");
        if (sql[j] === "'") {
          if (sql[j + 1] === "'") {
            j += 2;
            continue;
          }
          break;
        }
        j++;
      }
      code += "''";
      i = j + 1;
    } else {
      code += sql[i];
      i++;
    }
  }

  if (code.includes(";")) return fail("Only one statement is allowed.");
  if (code.includes("--") || code.includes("/*")) return fail("Comments are not allowed.");
  if (/\bu&/i.test(code)) return fail("Unicode escapes are not allowed.");
  if (!/^(select|with)\b/i.test(code)) return fail("Only SELECT queries are allowed.");
  const word = code.match(DENY_WORDS);
  if (word) return fail(`The keyword "${word[0].toLowerCase()}" is not allowed.`);
  if (DENY_FRAGMENTS.test(code)) return fail("System tables and functions are not allowed.");

  return { ok: true, sql };
}

// $1 is the row cap. Passing a parameter makes node-postgres use the extended protocol,
// so Postgres itself also refuses anything that is not a single statement.
export function limitWrap(sql: string): string {
  return `SELECT * FROM (${sql}) AS carry_result LIMIT $1`;
}
