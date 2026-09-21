import * as vscode from "vscode";
import type { SuiteQLColumnInfo, SuiteQLTableInfo } from "../schemaCache/schemaCacheTypes.js";

export class ConnectionRootNode extends vscode.TreeItem {
  constructor(
    public readonly profileId: string,
    label: string,
    realm: string,
    public readonly isActive: boolean,
  ) {
    super(label, isActive ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.None);
    this.description = isActive ? realm : `${realm} · disconnected`;
    this.contextValue = isActive ? "suiteql.connection.active" : "suiteql.connection.inactive";
    this.iconPath = new vscode.ThemeIcon(isActive ? "plug" : "debug-disconnect");
    if (!isActive) {
      this.command = { command: "suiteql.activateConnectionById", title: "Connect", arguments: [profileId] };
    }
  }
}

/**
 * Only ever rendered for tables that have actually been downloaded — see
 * `ObjectExplorerProvider`. Double-clicking (see `doubleClickToInsert.ts` — a plain
 * `TreeItem.command` fires on a single click, which is too eager for inserting text into
 * an editor) inserts `identifierText` into whichever SuiteQL editor last had focus.
 */
export class TableNode extends vscode.TreeItem {
  readonly identifierText: string;

  constructor(
    public readonly profileId: string,
    public readonly table: SuiteQLTableInfo,
  ) {
    // Same casing the completion provider inserts for a table (see `tableItem` in
    // completionProvider.ts) — double-clicking this node and autocompleting the table
    // name produce identical text.
    const displayName = table.tableName.toLowerCase();
    super(displayName, vscode.TreeItemCollapsibleState.Collapsed);
    this.identifierText = displayName;
    this.contextValue = "suiteql.table";
    this.iconPath = new vscode.ThemeIcon("table");
    this.tooltip = displayName;
  }
}

/** Double-clicking inserts `identifierText` — see `TableNode`'s doc comment. */
export class ColumnNode extends vscode.TreeItem {
  readonly identifierText: string;

  constructor(public readonly column: SuiteQLColumnInfo) {
    super(column.columnName, vscode.TreeItemCollapsibleState.None);
    this.identifierText = column.columnName;
    this.description = column.dataType;
    this.contextValue = "suiteql.column";
    this.iconPath = new vscode.ThemeIcon("symbol-field");
    this.tooltip = column.description ?? column.columnName;
  }
}

export class NoConnectionNode extends vscode.TreeItem {
  constructor() {
    super("No saved connections — click to add one", vscode.TreeItemCollapsibleState.None);
    this.contextValue = "suiteql.noConnection";
    this.command = { command: "suiteql.addConnection", title: "SuiteQL: Add Connection" };
  }
}

export class NoSchemaDownloadedNode extends vscode.TreeItem {
  constructor() {
    super("No schema downloaded — click to add tables", vscode.TreeItemCollapsibleState.None);
    this.contextValue = "suiteql.noSchema";
    this.command = { command: "suiteql.addTablesToSchema", title: "SuiteQL: Add Tables to Schema" };
  }
}

export class NoRestletConfiguredNode extends vscode.TreeItem {
  constructor(public readonly profileId: string) {
    super("RESTlet not configured — click to set one", vscode.TreeItemCollapsibleState.None);
    this.contextValue = "suiteql.noRestletConfigured";
    this.iconPath = new vscode.ThemeIcon("warning");
    this.tooltip = "Schema discovery is disabled until this connection has a RESTlet URL set.";
    this.command = { command: "suiteql.setRestletUrl", title: "Set RESTlet URL", arguments: [profileId] };
  }
}

export class NoFilterMatchesNode extends vscode.TreeItem {
  constructor(filterText: string) {
    super(`No tables or columns match "${filterText}"`, vscode.TreeItemCollapsibleState.None);
    this.contextValue = "suiteql.noFilterMatches";
  }
}

export type ObjectExplorerNode =
  | ConnectionRootNode
  | TableNode
  | ColumnNode
  | NoConnectionNode
  | NoSchemaDownloadedNode
  | NoRestletConfiguredNode
  | NoFilterMatchesNode;
