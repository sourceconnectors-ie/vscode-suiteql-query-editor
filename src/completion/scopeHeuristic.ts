import { SQL_KEYWORDS } from "./sqlKeywords.js";

const KEYWORD_SET = new Set(SQL_KEYWORDS.map((keyword) => keyword.toLowerCase()));

/** Maps a lowercase alias (or a bare, un-aliased table name) to its lowercase table name. */
export type AliasMap = Record<string, string>;

const FROM_JOIN_REGEX = /\b(from|join)\s+([a-zA-Z_]\w*)(?:\s+(?:as\s+)?([a-zA-Z_]\w*))?/gi;

/**
 * Scans the whole document text for `FROM <table> [AS] <alias>` / `JOIN ...` occurrences.
 * Deliberately not a real SQL parser — good enough for the common case of simple,
 * single-statement queries with zero or one alias per table reference.
 */
export function buildAliasMap(documentText: string): AliasMap {
  // Null-prototype so a lookup like `map["constructor"]` (from typing `constructor.`) misses
  // instead of returning Object.prototype's member, and an alias named `__proto__` is stored
  // as a key rather than hitting the prototype setter.
  const map: AliasMap = Object.create(null) as AliasMap;
  FROM_JOIN_REGEX.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = FROM_JOIN_REGEX.exec(documentText))) {
    const table = match[2]?.toLowerCase();
    const alias = match[3]?.toLowerCase();
    if (!table) {
      continue;
    }
    map[table] = table;
    // Guard against greedily capturing the next clause's keyword (e.g. "FROM customer WHERE")
    // as if it were an alias.
    if (alias && !KEYWORD_SET.has(alias)) {
      map[alias] = table;
    }
  }
  return map;
}

export type CursorScope =
  | { kind: "afterDot"; tableAliasOrName: string }
  | { kind: "afterFromJoin" }
  | { kind: "general" };

const AFTER_DOT_REGEX = /([a-zA-Z_]\w*)\.[a-zA-Z_]*$/;
const AFTER_FROM_JOIN_REGEX = /\b(?:from|join)\s+[a-zA-Z_]*$/i;

/** Looks only at the text before the cursor on the current line. */
export function detectCursorScope(linePrefix: string): CursorScope {
  const dotMatch = AFTER_DOT_REGEX.exec(linePrefix);
  if (dotMatch?.[1]) {
    return { kind: "afterDot", tableAliasOrName: dotMatch[1].toLowerCase() };
  }
  if (AFTER_FROM_JOIN_REGEX.test(linePrefix)) {
    return { kind: "afterFromJoin" };
  }
  return { kind: "general" };
}
