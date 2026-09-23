import * as vscode from "vscode";
import type { ActiveConnectionManager } from "../connection/activeConnection.js";
import type { ActiveSchemaCache } from "../schemaCache/activeSchemaCache.js";
import { getTableSchema } from "../schemaCache/schemaCacheTypes.js";
import { buildAliasMap } from "./scopeHeuristic.js";
import { SQL_KEYWORDS } from "./sqlKeywords.js";

const KEYWORD_SET = new Set(SQL_KEYWORDS.map((keyword) => keyword.toLowerCase()));
const IDENTIFIER_REGEX = /[a-zA-Z_]\w*/g;

const TOKEN_TYPES = ["class", "property"] as const;
export type SemanticTokenType = (typeof TOKEN_TYPES)[number];

export const suiteQLSemanticTokensLegend = new vscode.SemanticTokensLegend([...TOKEN_TYPES]);

export interface IdentifierToken {
  line: number;
  startChar: number;
  length: number;
  tokenType: SemanticTokenType;
}

/**
 * Blanks out single-quoted string literals, `--`/`#` line comments and `/* *\/` block
 * comments across the *whole* document (spaces in place of their content, newlines kept,
 * so every offset and line still lines up) — so identifier scanning never mistakes a word
 * inside one of those for a real table/column reference, e.g. `WHERE name = 'customer
 * service'` shouldn't highlight "customer" as a table. Done over the joined text rather
 * than line by line, since a block comment or a string can span several lines.
 * Double-quoted identifiers are left alone: those are real table/column references.
 */
function maskStringsAndComments(text: string): string {
  const out = text.split("");
  const blank = (from: number, to: number): void => {
    for (let k = from; k < to; k++) {
      if (out[k] !== "\n") {
        out[k] = " ";
      }
    }
  };
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    const next = text[i + 1];
    let end: number | undefined;
    if ((ch === "-" && next === "-") || ch === "#") {
      // `#` too — the statement splitter and SELECT parser both treat it as a line comment.
      const newline = text.indexOf("\n", i);
      end = newline === -1 ? text.length : newline;
    } else if (ch === "/" && next === "*") {
      const close = text.indexOf("*/", i + 2);
      end = close === -1 ? text.length : close + 2;
    } else if (ch === "'") {
      end = quotedSpanEnd(text, i);
    } else if (ch === '"') {
      // A quoted identifier is kept as-is (it's a real reference), but skipped as a unit so
      // a `#`, `--` or `'` inside it, e.g. `"x#y"`, isn't taken as the start of a comment
      // or string — the statement scanner skips it the same way.
      i = quotedSpanEnd(text, i);
      continue;
    }
    if (end === undefined) {
      i += 1;
    } else {
      blank(i, end);
      i = end;
    }
  }
  return out.join("");
}

/** Index just past the `'...'`/`"..."` span opening at `start`, honoring the doubled-quote escape. */
function quotedSpanEnd(text: string, start: number): number {
  const quote = text[start];
  let j = start + 1;
  while (j < text.length) {
    if (text[j] === quote) {
      if (text[j + 1] === quote) {
        j += 2;
        continue;
      }
      return j + 1;
    }
    j += 1;
  }
  return j;
}

/**
 * Pure scan over the document's lines, independent of `vscode.TextDocument`/`SemanticTokensBuilder` so
 * it can be unit-tested directly: a bare identifier is `class` if it matches a known table
 * name, `property` if it matches a column of one of the query's own referenced tables,
 * otherwise skipped entirely (left to whatever the TextMate grammar/theme already does).
 */
export function findIdentifierTokens(
  lines: readonly string[],
  knownTableNames: ReadonlySet<string>,
  knownColumnNames: ReadonlySet<string>,
): IdentifierToken[] {
  const tokens: IdentifierToken[] = [];
  const maskedLines = maskStringsAndComments(lines.join("\n")).split("\n");

  for (let lineNumber = 0; lineNumber < maskedLines.length; lineNumber++) {
    const maskedLine = maskedLines[lineNumber];
    IDENTIFIER_REGEX.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = IDENTIFIER_REGEX.exec(maskedLine))) {
      const lower = match[0].toLowerCase();
      if (KEYWORD_SET.has(lower)) {
        continue;
      }

      const tokenType: SemanticTokenType | undefined = knownTableNames.has(lower)
        ? "class"
        : knownColumnNames.has(lower)
          ? "property"
          : undefined;
      if (tokenType) {
        tokens.push({ line: lineNumber, startChar: match.index, length: match[0].length, tokenType });
      }
    }
  }

  return tokens;
}

/**
 * Colors known NetSuite table/column names distinctly from the rest of the query —
 * something a generic SQL TextMate grammar can never do, since it has no way to know
 * which identifiers are real schema names versus arbitrary SQL syntax. Complements (does
 * not replace) `suiteql.tmLanguage.json`'s delegation to `source.sql` for
 * keywords/strings/comments/operators.
 *
 * Deliberately not a real SQL parser — same "good enough for simple queries" heuristic
 * `scopeHeuristic.ts` already uses for completion: a bare identifier is tagged `class` if
 * it matches any known table name, else `property` if it matches a column of one of the
 * query's own referenced tables (via `buildAliasMap`), else left untouched entirely
 * (falls back to whatever the TextMate grammar/theme already does for it).
 */
export class SuiteQLSemanticTokensProvider implements vscode.DocumentSemanticTokensProvider, vscode.Disposable {
  private readonly refreshEmitter = new vscode.EventEmitter<void>();
  readonly onDidChangeSemanticTokens = this.refreshEmitter.event;
  private readonly subscriptions: vscode.Disposable[];

  constructor(
    private readonly activeConnection: ActiveConnectionManager,
    private readonly schemaCache: ActiveSchemaCache,
  ) {
    // Semantic tokens are only re-requested on document edits by default — a schema
    // download completing, or the active connection changing, doesn't touch the
    // document but does change which identifiers should now be colored.
    this.subscriptions = [
      this.refreshEmitter,
      this.activeConnection.onDidChangeActiveConnection(() => this.refreshEmitter.fire()),
      this.schemaCache.onDidChange(() => this.refreshEmitter.fire()),
    ];
  }

  dispose(): void {
    for (const subscription of this.subscriptions) {
      subscription.dispose();
    }
  }

  provideDocumentSemanticTokens(document: vscode.TextDocument): vscode.SemanticTokens | undefined {
    if (!this.activeConnection.get()) {
      return undefined;
    }
    const cache = this.schemaCache.get();
    if (!cache) {
      return undefined;
    }

    const documentText = document.getText();
    const referencedTableNames = new Set(Object.values(buildAliasMap(documentText)));
    const knownTableNames = new Set(cache.allTables.map((table) => table.tableName.toLowerCase()));

    const knownColumnNames = new Set<string>();
    for (const tableName of referencedTableNames) {
      const schema = getTableSchema(cache, tableName);
      if (!schema) {
        continue;
      }
      for (const column of schema.columns) {
        knownColumnNames.add(column.columnName.toLowerCase());
      }
    }

    const lines: string[] = [];
    for (let lineNumber = 0; lineNumber < document.lineCount; lineNumber++) {
      lines.push(document.lineAt(lineNumber).text);
    }

    const builder = new vscode.SemanticTokensBuilder(suiteQLSemanticTokensLegend);
    for (const token of findIdentifierTokens(lines, knownTableNames, knownColumnNames)) {
      builder.push(
        new vscode.Range(token.line, token.startChar, token.line, token.startChar + token.length),
        token.tokenType,
      );
    }
    return builder.build();
  }
}

export function registerSemanticTokensProvider(
  context: vscode.ExtensionContext,
  activeConnection: ActiveConnectionManager,
  schemaCache: ActiveSchemaCache,
): void {
  const provider = new SuiteQLSemanticTokensProvider(activeConnection, schemaCache);
  context.subscriptions.push(
    provider,
    vscode.languages.registerDocumentSemanticTokensProvider({ language: "suiteql" }, provider, suiteQLSemanticTokensLegend),
  );
}
