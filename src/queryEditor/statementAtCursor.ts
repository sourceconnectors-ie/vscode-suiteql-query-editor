import { splitSqlStatements } from "@monty-nabil/netsuite-api-client-ts";

interface StatementSpan {
  /** Offset of the statement's first non-whitespace character in the source text. */
  start: number;
  /** The statement itself, trimmed, without its `;`. */
  text: string;
}

/**
 * Splits `text` on top-level `;` the same way the vendored `splitSqlStatements` does
 * (ignoring `;` inside `'...'`/`"..."` literals, `--`/`#` line comments and block
 * comments), but keeps each statement's real position in the source instead of just its
 * text. Recovering positions afterwards by searching for the text isn't reliable: in
 * `select 1; /* select 2 *\/; select 2`, a search for "select 2" lands inside the comment.
 * Comment-only and blank segments are dropped, like `splitSqlStatements` does.
 */
function statementSpans(text: string): StatementSpan[] {
  const spans: StatementSpan[] = [];
  const pushSegment = (from: number, to: number): void => {
    // A segment holds no top-level `;`, so this yields the whole segment trimmed — or
    // nothing for a blank/comment-only one. Trimming only strips whitespace, so the
    // statement starts at the segment's first non-whitespace character.
    const segment = text.slice(from, to);
    const statement = splitSqlStatements(segment)[0];
    if (statement !== undefined) {
      spans.push({ start: from + segment.search(/\S/), text: statement });
    }
  };

  let segmentStart = 0;
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    const next = text[i + 1];
    if ((ch === "-" && next === "-") || ch === "#") {
      const newline = text.indexOf("\n", i);
      i = newline === -1 ? text.length : newline + 1;
    } else if (ch === "/" && next === "*") {
      const close = text.indexOf("*/", i + 2);
      i = close === -1 ? text.length : close + 2;
    } else if (ch === "'" || ch === '"') {
      let j = i + 1;
      while (j < text.length) {
        if (text[j] === ch) {
          if (text[j + 1] === ch) {
            j += 2; // '' / "" escape
            continue;
          }
          j += 1;
          break;
        }
        j += 1;
      }
      i = j;
    } else if (ch === ";") {
      pushSegment(segmentStart, i);
      i += 1;
      segmentStart = i;
    } else {
      i += 1;
    }
  }
  pushSegment(segmentStart, text.length);
  return spans;
}

/**
 * Picks the one statement "Run Query" should send, from a document that may hold several
 * `;`-separated statements (NetSuite's SuiteQL endpoint takes exactly one, with no trailing
 * `;`). Returns the statement the cursor at `offset` is in — or, between statements, the
 * one just before it (so a cursor left right after a `;` runs what was just typed) — or
 * the first statement when the cursor is before all of them. Trailing `;` is stripped.
 * `undefined` if the text holds no statement at all (blank, or comments only).
 */
export function statementAtOffset(text: string, offset: number): string | undefined {
  const spans = statementSpans(text);
  let chosen: StatementSpan | undefined;
  for (const span of spans) {
    if (span.start > offset) {
      break;
    }
    chosen = span;
  }
  return (chosen ?? spans[0])?.text;
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
