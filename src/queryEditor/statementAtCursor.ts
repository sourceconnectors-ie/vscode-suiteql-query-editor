import { splitSqlStatements } from "../../vendor/netsuite-api-client-ts/index.js";

/**
 * Picks the one statement "Run Query" should send, from a document that may hold several
 * `;`-separated statements (NetSuite's SuiteQL endpoint takes exactly one, with no trailing
 * `;`). Returns the statement the cursor at `offset` is in — or, between statements, the
 * one just before it (so a cursor left right after a `;` runs what was just typed) — or
 * the first statement when the cursor is before all of them. Trailing `;` is stripped.
 * `undefined` if the text holds no statement at all (blank, or comments only).
 */
export function statementAtOffset(text: string, offset: number): string | undefined {
  const statements = splitSqlStatements(text);
  let searchFrom = 0;
  let chosen: string | undefined;
  for (const statement of statements) {
    // Each statement is an exact (trimmed) substring of `text`, in order.
    const start = text.indexOf(statement, searchFrom);
    if (start === -1) {
      continue;
    }
    if (start > offset) {
      return chosen ?? statement;
    }
    chosen = statement;
    searchFrom = start + statement.length;
  }
  return chosen;
}

/**
 * For an explicit selection: its single statement with any trailing `;` stripped, or
 * `undefined` if it holds none. Throws when the selection spans more than one statement —
 * running only one of them silently would be surprising.
 */
export function singleStatement(text: string): string | undefined {
  const statements = splitSqlStatements(text);
  if (statements.length > 1) {
    throw new Error(`the selection contains ${statements.length} statements — select just one to run.`);
  }
  return statements[0];
}
