/**
 * Best-effort extraction of a SELECT statement's output column names, so the results
 * grid can pre-populate every intended column before any row data arrives — including one
 * that's null on *every* row of the result set and so never appears in any row's JSON at
 * all (NetSuite's SuiteQL REST endpoint omits null-valued keys entirely; `mergeColumns.ts`
 * is the row-data-driven half of this, catching anything this parse misses).
 *
 * Deliberately not a real SQL parser: splits the SELECT list on top-level commas
 * (respecting parens, string/quoted-identifier literals, and `--`, `#` and block comments — the same
 * character-scanning approach the library's `splitSqlStatements` uses, extended to
 * also track paren depth), then for each
 * expression prefers an explicit `AS alias`, falling back to a bare `table.column` or
 * `column` reference. An expression with neither (`SELECT *`, an unaliased function
 * call/expression) is skipped — `mergeColumns.ts` still catches it once any row actually
 * has a value for it.
 */
export function parseSelectColumns(queryText: string): string[] {
  const columns: string[] = [];
  for (const { outputName } of parseSelectColumnDetails(queryText) ?? []) {
    if (!columns.includes(outputName)) {
      columns.push(outputName);
    }
  }
  return columns;
}

export interface SelectColumnDetail {
  /** The name this column will actually appear under in a result row — the explicit
   * alias if given, else the bare column name from a simple `column`/`table.column`
   * reference. */
  outputName: string;
  /** The column actually being selected, when the expression (ignoring any `AS alias`)
   * is a simple bare `column` or `table.column` reference — `undefined` for anything
   * more complex (a function call, arithmetic), where the real source column can't be
   * determined without actually running the query. For an unaliased simple reference
   * this equals `outputName`. */
  sourceColumnName: string | undefined;
}

/**
 * Like {@link parseSelectColumns}, but also resolves each output column back to the
 * actual source column it selects from — e.g. `SELECT entityid AS id` yields
 * `{outputName: "id", sourceColumnName: "entityid"}`, not `"id"` alone. A caller doing
 * type-based coercion needs this: keying purely by output name risks an alias silently
 * inheriting an unrelated schema column's type just because they share a name (see
 * `columnTypeCoercion.ts`).
 *
 * Returns `undefined` for a `SELECT *`-style query (or one this can't parse at all) — a
 * wildcard's expanded column set can't be determined without a real parser, and callers
 * should fall back to treating every schema column of the referenced tables as a real,
 * unaliased output column instead of silently getting zero columns back.
 */
export function parseSelectColumnDetails(queryText: string): SelectColumnDetail[] | undefined {
  const selectList = extractSelectListText(queryText);
  if (selectList === undefined) {
    return undefined;
  }

  const details: SelectColumnDetail[] = [];
  for (const rawSegment of splitTopLevelCommas(selectList)) {
    const segment = rawSegment.trim();
    if (!segment) {
      continue;
    }
    if (WILDCARD_REGEX.test(segment)) {
      return undefined; // `*` or `table.*` — can't enumerate without running the query
    }
    const detail = columnDetailForSegment(segment);
    if (detail) {
      details.push(detail);
    }
  }
  return details;
}

const SELECT_WORD_REGEX = /select/iy;
const SELECT_PREFIX_REGEX = /select\s+(?:top\s+\d+\s+)?(?:distinct\s+)?/iy;
const FROM_WORD_REGEX = /from/iy;

/** Returns the text between the outermost `SELECT [TOP n] [DISTINCT]` and its top-level
 * `FROM`, or `undefined` if either isn't found (not a plain SELECT statement this can
 * handle). The SELECT itself is found with the same top-level scan as FROM, so a "select"
 * inside a leading comment, a string, or a parenthesized `WITH ... AS (SELECT ...)` CTE
 * body is never mistaken for the statement's own SELECT list. */
function extractSelectListText(queryText: string): string | undefined {
  const selectIndex = findTopLevelKeyword(queryText, 0, SELECT_WORD_REGEX);
  if (selectIndex === undefined) {
    return undefined;
  }
  SELECT_PREFIX_REGEX.lastIndex = selectIndex;
  const prefixMatch = SELECT_PREFIX_REGEX.exec(queryText);
  if (!prefixMatch) {
    return undefined;
  }

  const start = selectIndex + prefixMatch[0].length;
  const fromIndex = findTopLevelKeyword(queryText, start, FROM_WORD_REGEX);
  return fromIndex === undefined ? undefined : queryText.slice(start, fromIndex);
}

/** Scans from `start`, respecting parens/quotes/comments, for the first top-level
 * occurrence of a keyword matched by `wordRegex` (a sticky, case-insensitive, `\b`-free
 * regex — word-boundary checking is done manually here since the scan is character by
 * character, and on *both* sides of the match: checking only the preceding character
 * would let e.g. the "from" inside "fromage" match FROM and cut the SELECT list short
 * mid-identifier). Returns the match's start index, or `undefined` if never found before
 * the string ends or paren depth would go negative (malformed input). */
function findTopLevelKeyword(text: string, start: number, wordRegex: RegExp): number | undefined {
  let i = start;
  let parenDepth = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === "'" || ch === '"') {
      i = skipQuoted(text, i, ch);
      continue;
    }
    if ((ch === "-" && text[i + 1] === "-") || ch === "#") {
      i = skipLineComment(text, i); // `#` too — matches the vendored splitSqlStatements Run Query uses
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
      const match = wordRegex.exec(text);
      if (match && !isIdentifierChar(text[i + match[0].length])) {
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
    if ((ch === "-" && text[i + 1] === "-") || ch === "#") {
      i = skipLineComment(text, i); // `#` too — matches the vendored splitSqlStatements Run Query uses
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

/** Identifier characters per `IDENTIFIER` below — `$` counts (NetSuite/SuiteQL allows it
 * in identifiers), so it must also count when deciding whether a keyword match is
 * actually standalone (e.g. rejecting "from" inside a hypothetical `a$from` reference). */
function isIdentifierChar(ch: string | undefined): boolean {
  return ch !== undefined && /[\w$]/.test(ch);
}

function isWordBoundary(text: string, i: number): boolean {
  return i === 0 || !isIdentifierChar(text[i - 1]);
}

const IDENTIFIER = String.raw`[a-zA-Z_][\w$]*`;
const WILDCARD_REGEX = new RegExp(String.raw`^(?:${IDENTIFIER}\.)?\*$`);
const TRAILING_AS_ALIAS_REGEX = new RegExp(String.raw`\bas\s+(${IDENTIFIER}|"[^"]+")\s*$`, "i");
const SIMPLE_COLUMN_REF_REGEX = new RegExp(String.raw`^(?:(${IDENTIFIER})\.)?(${IDENTIFIER})$`);

/** The output column name (and, when determinable, the underlying source column name)
 * for one SELECT-list expression — `undefined` if the expression is empty or unusable
 * (shouldn't happen given callers already skip blank segments and wildcards). */
function columnDetailForSegment(segment: string): SelectColumnDetail | undefined {
  const aliasMatch = TRAILING_AS_ALIAS_REGEX.exec(segment);
  if (aliasMatch) {
    const rawAlias = aliasMatch[1];
    const outputName = rawAlias.startsWith('"') ? rawAlias.slice(1, -1) : rawAlias;
    const beforeAlias = segment.slice(0, aliasMatch.index).trim();
    const sourceMatch = SIMPLE_COLUMN_REF_REGEX.exec(beforeAlias);
    return { outputName, sourceColumnName: sourceMatch ? sourceMatch[2] : undefined };
  }

  const bareMatch = SIMPLE_COLUMN_REF_REGEX.exec(segment);
  if (bareMatch) {
    return { outputName: bareMatch[2], sourceColumnName: bareMatch[2] };
  }

  return undefined;
}
