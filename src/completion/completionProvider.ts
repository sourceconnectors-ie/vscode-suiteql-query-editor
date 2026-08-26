import * as vscode from "vscode";
import type { FieldSchema, RecordTypeInfo } from "../../vendor/netsuite-api-client-ts/index.js";
import type { ActiveConnectionManager } from "../connection/activeConnection.js";
import type { ActiveSchemaCache } from "../schemaCache/activeSchemaCache.js";
import { buildAliasMap, detectCursorScope } from "./scopeHeuristic.js";
import { SQL_KEYWORDS } from "./sqlKeywords.js";

function fieldItem(field: FieldSchema): vscode.CompletionItem {
  const item = new vscode.CompletionItem(field.name, vscode.CompletionItemKind.Field);
  item.detail = field.dataType;
  item.documentation = field.description ?? field.label;
  return item;
}

function recordTypeItem(recordType: RecordTypeInfo): vscode.CompletionItem {
  const item = new vscode.CompletionItem(recordType.id, vscode.CompletionItemKind.Class);
  item.detail = recordType.label;
  return item;
}

function keywordItem(keyword: string): vscode.CompletionItem {
  return new vscode.CompletionItem(keyword, vscode.CompletionItemKind.Keyword);
}

/**
 * Completion for SuiteQL keywords, record type names (after FROM/JOIN), and column
 * names (after `alias.`), sourced entirely from the active connection's downloaded
 * schema cache. Not a real SQL parser — see `scopeHeuristic.ts` for the deliberately
 * simple heuristics this relies on.
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
      const recordTypeId = aliasMap[scope.tableAliasOrName] ?? scope.tableAliasOrName;
      const schema = cache.schemas[recordTypeId];
      return schema ? schema.fields.map(fieldItem) : [];
    }

    if (scope.kind === "afterFromJoin") {
      if (!cache) {
        return [];
      }
      return cache.allRecordTypes.filter((recordType) => recordType.supportsSuiteQL).map(recordTypeItem);
    }

    const items = SQL_KEYWORDS.map(keywordItem);
    if (!cache) {
      return items;
    }

    const aliasMap = buildAliasMap(document.getText());
    const referencedRecordTypeIds = new Set(Object.values(aliasMap));
    for (const recordTypeId of referencedRecordTypeIds) {
      const schema = cache.schemas[recordTypeId];
      if (schema) {
        items.push(...schema.fields.map(fieldItem));
      }
    }
    for (const recordType of cache.allRecordTypes) {
      if (recordType.supportsSuiteQL) {
        items.push(recordTypeItem(recordType));
      }
    }

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
