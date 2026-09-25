import * as vscode from "vscode";
import type { ActiveConnectionManager } from "../connection/activeConnection.js";
import type { ConnectionProfileStore } from "../connection/connectionProfileStore.js";
import type { ActiveSchemaCache } from "../schemaCache/activeSchemaCache.js";
import { getTableSchema, type SchemaCacheFile, type SuiteQLColumnInfo, type SuiteQLTableInfo } from "../schemaCache/schemaCacheTypes.js";
import {
  AttributionNode,
  ColumnNode,
  ConnectionRootNode,
  NoConnectionNode,
  NoFilterMatchesNode,
  NoRestletConfiguredNode,
  NoSchemaDownloadedNode,
  TableNode,
  type ObjectExplorerNode,
} from "./nodes.js";

function matchesText(needle: string, ...haystack: string[]): boolean {
  return haystack.some((value) => value.toLowerCase().includes(needle));
}

/**
 * Lists every saved connection profile at the root (not just the active one), each
 * showing connected/disconnected state — clicking a disconnected one activates it.
 * Only the active connection's node expands into its downloaded schema (tables/columns
 * discovered via a per-connection RESTlet — see `restletSchemaDiscovery.ts`), sourced
 * entirely from `ActiveSchemaCache` — expansion never fetches anything itself. An active
 * connection with no RESTlet URL set shows `NoRestletConfiguredNode` instead of expanding.
 *
 * Supports an optional case-insensitive filter (see `setFilter`) over table and column
 * names. A table matching by its own name shows all its columns; one matching only
 * because a column inside it matches shows just that column, so the filter narrows
 * leaves while still surfacing their ancestor.
 */
export class ObjectExplorerProvider implements vscode.TreeDataProvider<ObjectExplorerNode>, vscode.Disposable {
  private readonly changeEmitter = new vscode.EventEmitter<ObjectExplorerNode | undefined>();
  readonly onDidChangeTreeData = this.changeEmitter.event;

  private filterText: string | undefined;
  private readonly subscriptions: vscode.Disposable[];

  constructor(
    private readonly activeConnection: ActiveConnectionManager,
    private readonly schemaCache: ActiveSchemaCache,
    private readonly profileStore: ConnectionProfileStore,
  ) {
    this.subscriptions = [
      this.changeEmitter,
      this.activeConnection.onDidChangeActiveConnection(() => this.refresh()),
      this.schemaCache.onDidChange(() => this.refresh()),
    ];
  }

  dispose(): void {
    for (const subscription of this.subscriptions) {
      subscription.dispose();
    }
  }

  getFilter(): string | undefined {
    return this.filterText;
  }

  setFilter(text: string | undefined): void {
    this.filterText = text?.trim().toLowerCase() || undefined;
    this.refresh();
  }

  refresh(): void {
    this.changeEmitter.fire(undefined);
  }

  getTreeItem(element: ObjectExplorerNode): vscode.TreeItem {
    return element;
  }

  getChildren(element?: ObjectExplorerNode): ObjectExplorerNode[] {
    if (!element) {
      const profiles = this.profileStore.getAll();
      // Appended to the root regardless of what else is showing — including the empty
      // state — so it's visible whenever the panel is open, without displacing the
      // connection list or the "add one" prompt.
      if (profiles.length === 0) {
        return [new NoConnectionNode(), new AttributionNode()];
      }
      const activeId = this.activeConnection.get()?.profile.id;
      const roots = profiles
        .map((profile) => new ConnectionRootNode(profile.id, profile.label, profile.realm, profile.id === activeId))
        .sort((a, b) => String(a.label).localeCompare(String(b.label)));
      return [...roots, new AttributionNode()];
    }

    if (element instanceof ConnectionRootNode) {
      if (!element.isActive) {
        return [];
      }
      if (!this.activeConnection.get()?.profile.restletUrl) {
        return [new NoRestletConfiguredNode(element.profileId)];
      }
      const cache = this.schemaCache.get();
      if (!cache) {
        return [new NoSchemaDownloadedNode()];
      }
      let tables = Object.values(cache.schemas).map((schema) => schema.table);
      if (tables.length === 0) {
        return [new NoSchemaDownloadedNode()];
      }

      if (this.filterText) {
        tables = tables.filter((table) => this.tableMatches(table, cache));
        if (tables.length === 0) {
          return [new NoFilterMatchesNode(this.filterText)];
        }
      }

      return tables
        .map((table) => new TableNode(element.profileId, table))
        .sort((a, b) => String(a.label).localeCompare(String(b.label)));
    }

    if (element instanceof TableNode) {
      const cache = this.schemaCache.get();
      const schema = cache && getTableSchema(cache, element.table.tableName.toLowerCase());
      if (!schema) {
        return [];
      }
      const columns = this.filterText ? this.matchingColumns(element.table, schema.columns) : schema.columns;
      return columns
        .slice()
        .sort((a, b) => a.columnName.localeCompare(b.columnName))
        .map((column) => new ColumnNode(column));
    }

    return [];
  }

  private tableMatches(table: SuiteQLTableInfo, cache: SchemaCacheFile): boolean {
    const filterText = this.filterText;
    if (!filterText) {
      return true;
    }
    if (matchesText(filterText, table.tableName)) {
      return true;
    }
    const schema = getTableSchema(cache, table.tableName.toLowerCase());
    return schema?.columns.some((column) => matchesText(filterText, column.columnName)) ?? false;
  }

  private matchingColumns(table: SuiteQLTableInfo, columns: SuiteQLColumnInfo[]): SuiteQLColumnInfo[] {
    const filterText = this.filterText;
    if (!filterText) {
      return columns;
    }
    if (matchesText(filterText, table.tableName)) {
      return columns; // matched by the table's own name — show all of its columns
    }
    return columns.filter((column) => matchesText(filterText, column.columnName));
  }
}
