/**
 * Best-effort extraction of a SELECT statement's output column names, so the results
 * grid can pre-populate every intended column before any row data arrives — including one
 * that's null on *every* row of the result set and so never appears in any row's JSON at
 * all (NetSuite's SuiteQL REST endpoint omits null-valued keys entirely; `mergeColumns.ts`
 * is the row-data-driven half of this, catching anything this parse misses).
 *
 * Deliberately not a real SQL parser: splits the SELECT list on top-level commas
 * (respecting parens, string/quoted-identifier literals, and comments — the same
 * character-scanning approach `vendor/netsuite-api-client-ts/sql.ts`'s
 * `splitSqlStatements` uses, extended to also track paren depth), then for each
 * expression prefers an explicit `AS alias`, falling back to a bare `table.column` or
 * `column` reference. An expression with neither (`SELECT *`, an unaliased function
 * call/expression) is skipped — `mergeColumns.ts` still catches it once any row actually
 * has a value for it.
 */
export function parseSelectColumns(queryText: string): string[] {
  const selectList = extractSelectListText(queryText);
  if (selectList === undefined) {
    return [];
  }

  const columns: string[] = [];
  for (const segment of splitTopLevelCommas(selectList)) {
    const name = columnNameForSegment(segment);
    if (name && !columns.includes(name)) {
      columns.push(name);
    }
  }
  return columns;
}

const SELECT_PREFIX_REGEX = /\bselect\b\s+(?:top\s+\d+\s+)?(?:distinct\s+)?/i;
const FROM_WORD_REGEX = /from/iy;

/** Returns the text between `SELECT [TOP n] [DISTINCT]` and the top-level `FROM`, or
 * `undefined` if either isn't found (not a plain SELECT statement this can handle). */
function extractSelectListText(queryText: string): string | undefined {
  const prefixMatch = SELECT_PREFIX_REGEX.exec(queryText);
  if (!prefixMatch) {
    return undefined;
  }

  const start = prefixMatch.index + prefixMatch[0].length;
  const fromIndex = findTopLevelKeyword(queryText, start, FROM_WORD_REGEX);
  return fromIndex === undefined ? undefined : queryText.slice(start, fromIndex);
}

/** Scans from `start`, respecting parens/quotes/comments, for the first top-level
 * occurrence of a keyword matched by `wordRegex` (a sticky, case-insensitive, `\b`-free
 * regex — word-boundary checking is done manually here since the scan is character by
 * character). Returns its start index, or `undefined` if never found before the string
 * ends or paren depth would go negative (malformed input). */
function findTopLevelKeyword(text: string, start: number, wordRegex: RegExp): number | undefined {
  let i = start;
  let parenDepth = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === "'" || ch === '"') {
      i = skipQuoted(text, i, ch);
      continue;
    }
    if (ch === "-" && text[i + 1] === "-") {
      i = skipLineComment(text, i);
      continue;
    }
    if (ch === "/" && text[i + 1] === "*") {
      i = skipBlockComment(text, i);
      continue;
    }
    if (ch === "(") {
      parenDepth += 1;
      i += 1;
      continue;
    }
    if (ch === ")") {
      parenDepth = Math.max(0, parenDepth - 1);
      i += 1;
      continue;
    }
    if (parenDepth === 0 && isWordBoundary(text, i)) {
      wordRegex.lastIndex = i;
      if (wordRegex.test(text)) {
        return i;
      }
    }
    i += 1;
  }
  return undefined;
}

/** Splits `text` on commas at paren-depth 0, respecting quotes/comments the same way
 * `findTopLevelKeyword` does. */
function splitTopLevelCommas(text: string): string[] {
  const segments: string[] = [];
  let segmentStart = 0;
  let parenDepth = 0;
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === "'" || ch === '"') {
      i = skipQuoted(text, i, ch);
      continue;
    }
    if (ch === "-" && text[i + 1] === "-") {
      i = skipLineComment(text, i);
      continue;
    }
    if (ch === "/" && text[i + 1] === "*") {
      i = skipBlockComment(text, i);
      continue;
    }
    if (ch === "(") {
      parenDepth += 1;
      i += 1;
      continue;
    }
    if (ch === ")") {
      parenDepth = Math.max(0, parenDepth - 1);
      i += 1;
      continue;
    }
    if (ch === "," && parenDepth === 0) {
      segments.push(text.slice(segmentStart, i));
      i += 1;
      segmentStart = i;
      continue;
    }
    i += 1;
  }
  segments.push(text.slice(segmentStart));
  return segments;
}

function skipQuoted(text: string, i: number, quoteChar: string): number {
  let j = i + 1;
  while (j < text.length) {
    if (text[j] === quoteChar) {
      if (text[j + 1] === quoteChar) {
        j += 2;
        continue;
      }
      return j + 1;
    }
    j += 1;
  }
  return j;
}

function skipLineComment(text: string, i: number): number {
  const newline = text.indexOf("\n", i);
  return newline === -1 ? text.length : newline + 1;
}

function skipBlockComment(text: string, i: number): number {
  const end = text.indexOf("*/", i + 2);
  return end === -1 ? text.length : end + 2;
}

function isWordBoundary(text: string, i: number): boolean {
  return i === 0 || !/\w/.test(text[i - 1]);
}

const IDENTIFIER = String.raw`[a-zA-Z_][\w$]*`;
const TRAILING_AS_ALIAS_REGEX = new RegExp(String.raw`\bas\s+(${IDENTIFIER}|"[^"]+")\s*$`, "i");
const SIMPLE_COLUMN_REF_REGEX = new RegExp(String.raw`^(?:${IDENTIFIER}\.)?(${IDENTIFIER})$`);

/** The output column name for one SELECT-list expression, or `undefined` if it can't be
 * determined without actually running the query (an unaliased function call/expression,
 * or `*`). */
function columnNameForSegment(rawSegment: string): string | undefined {
  const segment = rawSegment.trim();
  if (!segment) {
    return undefined;
  }

  const aliasMatch = TRAILING_AS_ALIAS_REGEX.exec(segment);
  if (aliasMatch) {
    const alias = aliasMatch[1];
    return alias.startsWith('"') ? alias.slice(1, -1) : alias;
  }

  const bareMatch = SIMPLE_COLUMN_REF_REGEX.exec(segment);
  return bareMatch ? bareMatch[1] : undefined;
}
