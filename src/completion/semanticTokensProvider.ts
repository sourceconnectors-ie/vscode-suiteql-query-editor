import * as vscode from "vscode";
import type { ActiveConnectionManager } from "../connection/activeConnection.js";
import type { ActiveSchemaCache } from "../schemaCache/activeSchemaCache.js";
import { buildAliasMap } from "./scopeHeuristic.js";
import { SQL_KEYWORDS } from "./sqlKeywords.js";

const KEYWORD_SET = new Set(SQL_KEYWORDS.map((keyword) => keyword.toLowerCase()));
const IDENTIFIER_REGEX = /[a-zA-Z_]\w*/g;
/** Matches a single-quoted SQL string literal, `''` (a literal quote) included. */
const STRING_LITERAL_REGEX = /'(?:[^']|'')*'/g;
const LINE_COMMENT_REGEX = /--.*$/;

const TOKEN_TYPES = ["class", "property"] as const;
export type SemanticTokenType = (typeof TOKEN_TYPES)[number];

export const suiteQLSemanticTokensLegend = new vscode.SemanticTokensLegend([...TOKEN_TYPES]);

export interface IdentifierToken {
  line: number;
  startChar: number;
  length: number;
  tokenType: SemanticTokenType;
}

/** Blanks out string literals and line comments (same length, spaces in place of their
 * content) so identifier scanning never mistakes a word inside one of those for a real
 * table/column reference — e.g. `WHERE name = 'customer service'` shouldn't highlight
 * "customer" as a table. */
function maskStringsAndComments(lineText: string): string {
  let masked = lineText.replace(STRING_LITERAL_REGEX, (match) => " ".repeat(match.length));
  masked = masked.replace(LINE_COMMENT_REGEX, (match) => " ".repeat(match.length));
  return masked;
}

/**
 * Pure line-by-line scan, independent of `vscode.TextDocument`/`SemanticTokensBuilder` so
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

  for (let lineNumber = 0; lineNumber < lines.length; lineNumber++) {
    const maskedLine = maskStringsAndComments(lines[lineNumber]);
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
      const schema = cache.schemas[tableName];
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
