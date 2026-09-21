import * as vscode from "vscode";
import type { ActiveConnectionManager } from "../connection/activeConnection.js";
import type { ActiveSchemaCache } from "../schemaCache/activeSchemaCache.js";
import type { SuiteQLColumnInfo, SuiteQLTableInfo } from "../schemaCache/schemaCacheTypes.js";
import { buildAliasMap, detectCursorScope } from "./scopeHeuristic.js";
import { SQL_KEYWORDS } from "./sqlKeywords.js";

function columnItem(column: SuiteQLColumnInfo): vscode.CompletionItem {
  const item = new vscode.CompletionItem(column.columnName, vscode.CompletionItemKind.Field);
  item.detail = column.dataType;
  item.documentation = column.description;
  return item;
}

function tableItem(table: SuiteQLTableInfo): vscode.CompletionItem {
  return new vscode.CompletionItem(table.tableName.toLowerCase(), vscode.CompletionItemKind.Class);
}

function keywordItem(keyword: string): vscode.CompletionItem {
  return new vscode.CompletionItem(keyword, vscode.CompletionItemKind.Keyword);
}

/**
 * Completion for SuiteQL keywords, table names (after FROM/JOIN), and column names
 * (after `alias.`), sourced entirely from the active connection's downloaded schema
 * cache (tables/columns discovered via a per-connection RESTlet — see
 * `restletSchemaDiscovery.ts`). Not a real SQL parser — see `scopeHeuristic.ts` for the
 * deliberately simple heuristics this relies on.
 */
export class SuiteQLCompletionProvider implements vscode.CompletionItemProvider {
  constructor(
    private readonly activeConnection: ActiveConnectionManager,
    private readonly schemaCache: ActiveSchemaCache,
  ) {}

  provideCompletionItems(document: vscode.TextDocument, position: vscode.Position): vscode.CompletionItem[] {
    if (!this.activeConnection.get()) {
      return [];
    }

    const cache = this.schemaCache.get();
    const linePrefix = document.lineAt(position.line).text.slice(0, position.character);
    const scope = detectCursorScope(linePrefix);

    if (scope.kind === "afterDot") {
      if (!cache) {
        return [];
      }
      const aliasMap = buildAliasMap(document.getText());
      const tableName = aliasMap[scope.tableAliasOrName] ?? scope.tableAliasOrName;
      const schema = cache.schemas[tableName];
      return schema ? schema.columns.map(columnItem) : [];
    }

    if (scope.kind === "afterFromJoin") {
      if (!cache) {
        return [];
      }
      return cache.allTables.map(tableItem);
    }

    const items = SQL_KEYWORDS.map(keywordItem);
    if (!cache) {
      return items;
    }

    const aliasMap = buildAliasMap(document.getText());
    const referencedTableNames = new Set(Object.values(aliasMap));
    for (const tableName of referencedTableNames) {
      const schema = cache.schemas[tableName];
      if (schema) {
        items.push(...schema.columns.map(columnItem));
      }
    }
    items.push(...cache.allTables.map(tableItem));

    return items;
  }
}

export function registerCompletionProvider(
  context: vscode.ExtensionContext,
  activeConnection: ActiveConnectionManager,
  schemaCache: ActiveSchemaCache,
): void {
  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider(
      { language: "suiteql" },
      new SuiteQLCompletionProvider(activeConnection, schemaCache),
      ".",
      " ",
    ),
  );
}
