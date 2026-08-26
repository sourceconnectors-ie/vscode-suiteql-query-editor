/**
 * Splits a SQL script into individual statements on top-level semicolons, ignoring
 * semicolons inside:
 *  - single-quoted string literals ('...'), honoring the '' escape
 *  - double-quoted identifiers ("..."), honoring the "" escape
 *  - line comments (-- ... and # ...) through end of line
 *  - block comments (/* ... *\/)
 *
 * Statements are trimmed; statements that are empty or comment-only are dropped.
 */
export function splitSqlStatements(content: string): string[] {
  const statements: string[] = [];
  let buf = "";
  let i = 0;
  const n = content.length;
  let inSingle = false;
  let inDouble = false;
  let inLineComment = false;
  let inBlockComment = false;

  while (i < n) {
    const ch = content[i] as string;
    const nxt = i + 1 < n ? content[i + 1] : "";

    if (inLineComment) {
      buf += ch;
      if (ch === "\n") {
        inLineComment = false;
      }
      i += 1;
      continue;
    }

    if (inBlockComment) {
      buf += ch;
      if (ch === "*" && nxt === "/") {
        buf += nxt;
        inBlockComment = false;
        i += 2;
        continue;
      }
      i += 1;
      continue;
    }

    if (inSingle) {
      buf += ch;
      if (ch === "'") {
        if (nxt === "'") {
          buf += nxt;
          i += 2;
          continue;
        }
        inSingle = false;
      }
      i += 1;
      continue;
    }

    if (inDouble) {
      buf += ch;
      if (ch === '"') {
        if (nxt === '"') {
          buf += nxt;
          i += 2;
          continue;
        }
        inDouble = false;
      }
      i += 1;
      continue;
    }

    // Top level
    if (ch === "-" && nxt === "-") {
      inLineComment = true;
      buf += ch + nxt;
      i += 2;
      continue;
    }
    if (ch === "#") {
      inLineComment = true;
      buf += ch;
      i += 1;
      continue;
    }
    if (ch === "/" && nxt === "*") {
      inBlockComment = true;
      buf += ch + nxt;
      i += 2;
      continue;
    }
    if (ch === "'") {
      inSingle = true;
      buf += ch;
      i += 1;
      continue;
    }
    if (ch === '"') {
      inDouble = true;
      buf += ch;
      i += 1;
      continue;
    }
    if (ch === ";") {
      statements.push(buf);
      buf = "";
      i += 1;
      continue;
    }

    buf += ch;
    i += 1;
  }

  statements.push(buf);

  return statements
    .map((stmt) => stmt.trim())
    .filter((stmt) => stmt.length > 0 && !isCommentOnly(stmt));
}

function isCommentOnly(stmt: string): boolean {
  let i = 0;
  const n = stmt.length;
  while (i < n) {
    const ch = stmt[i] as string;
    const nxt = i + 1 < n ? stmt[i + 1] : "";
    if (/\s/.test(ch)) {
      i += 1;
      continue;
    }
    if (ch === "-" && nxt === "-") {
      while (i < n && stmt[i] !== "\n") {
        i += 1;
      }
      continue;
    }
    if (ch === "#") {
      while (i < n && stmt[i] !== "\n") {
        i += 1;
      }
      continue;
    }
    if (ch === "/" && nxt === "*") {
      i += 2;
      while (i < n && !(stmt[i] === "*" && i + 1 < n && stmt[i + 1] === "/")) {
        i += 1;
      }
      i += 2;
      continue;
    }
    return false;
  }
  return true;
}
