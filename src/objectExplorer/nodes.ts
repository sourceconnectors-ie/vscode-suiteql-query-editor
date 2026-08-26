import * as vscode from "vscode";
import type { FieldSchema, RecordTypeInfo } from "../../vendor/netsuite-api-client-ts/index.js";

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

export class RecordTypeNode extends vscode.TreeItem {
  constructor(
    public readonly profileId: string,
    public readonly recordType: RecordTypeInfo,
    public readonly isDownloaded: boolean,
  ) {
    super(
      recordType.label,
      isDownloaded ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None,
    );
    this.description = isDownloaded ? recordType.id : `${recordType.id} · not added`;
    this.contextValue = isDownloaded ? "suiteql.recordType.downloaded" : "suiteql.recordType.notDownloaded";
    this.iconPath = new vscode.ThemeIcon(isDownloaded ? "table" : "circle-outline");
    this.tooltip = recordType.isCustom ? `${recordType.label} (custom record)` : recordType.label;
  }
}

export class FieldNode extends vscode.TreeItem {
  constructor(public readonly field: FieldSchema) {
    super(field.name, vscode.TreeItemCollapsibleState.None);
    this.description = `${field.dataType}${field.isRequired ? ", required" : ""}`;
    this.contextValue = "suiteql.field";
    this.iconPath = new vscode.ThemeIcon(field.isCustom ? "symbol-field" : "symbol-property");
    this.tooltip = field.description ?? field.label;
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
    super("No schema downloaded — click to add record types", vscode.TreeItemCollapsibleState.None);
    this.contextValue = "suiteql.noSchema";
    this.command = { command: "suiteql.addRecordTypesToSchema", title: "SuiteQL: Add Record Types to Schema" };
  }
}

export class NoFilterMatchesNode extends vscode.TreeItem {
  constructor(filterText: string) {
    super(`No record types or fields match "${filterText}"`, vscode.TreeItemCollapsibleState.None);
    this.contextValue = "suiteql.noFilterMatches";
  }
}

export type ObjectExplorerNode =
  | ConnectionRootNode
  | RecordTypeNode
  | FieldNode
  | NoConnectionNode
  | NoSchemaDownloadedNode
  | NoFilterMatchesNode;
