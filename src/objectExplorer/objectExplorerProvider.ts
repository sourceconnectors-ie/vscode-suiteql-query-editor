import * as vscode from "vscode";
import type { FieldSchema, RecordTypeInfo } from "../../vendor/netsuite-api-client-ts/index.js";
import type { ActiveConnectionManager } from "../connection/activeConnection.js";
import type { ConnectionProfileStore } from "../connection/connectionProfileStore.js";
import type { ActiveSchemaCache } from "../schemaCache/activeSchemaCache.js";
import type { SchemaCacheFile } from "../schemaCache/schemaCacheTypes.js";
import {
  ConnectionRootNode,
  FieldNode,
  NoConnectionNode,
  NoFilterMatchesNode,
  NoSchemaDownloadedNode,
  RecordTypeNode,
  type ObjectExplorerNode,
} from "./nodes.js";

function matchesText(needle: string, ...haystack: string[]): boolean {
  return haystack.some((value) => value.toLowerCase().includes(needle));
}

/**
 * Lists every saved connection profile at the root (not just the active one), each
 * showing connected/disconnected state — clicking a disconnected one activates it.
 * Only the active connection's node expands into its downloaded schema, sourced
 * entirely from `ActiveSchemaCache` — expansion never fetches anything itself.
 *
 * Supports an optional case-insensitive filter (see `setFilter`) over record type
 * ids/labels and field names/labels. A record type matching by its own name shows all
 * its fields; one matching only because a field inside it matches shows just that
 * field, so the filter narrows leaves while still surfacing their ancestor.
 */
export class ObjectExplorerProvider implements vscode.TreeDataProvider<ObjectExplorerNode> {
  private readonly changeEmitter = new vscode.EventEmitter<ObjectExplorerNode | undefined>();
  readonly onDidChangeTreeData = this.changeEmitter.event;

  private filterText: string | undefined;

  constructor(
    private readonly activeConnection: ActiveConnectionManager,
    private readonly schemaCache: ActiveSchemaCache,
    private readonly profileStore: ConnectionProfileStore,
  ) {
    this.activeConnection.onDidChangeActiveConnection(() => this.refresh());
    this.schemaCache.onDidChange(() => this.refresh());
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
      if (profiles.length === 0) {
        return [new NoConnectionNode()];
      }
      const activeId = this.activeConnection.get()?.profile.id;
      return profiles
        .map((profile) => new ConnectionRootNode(profile.id, profile.label, profile.realm, profile.id === activeId))
        .sort((a, b) => String(a.label).localeCompare(String(b.label)));
    }

    if (element instanceof ConnectionRootNode) {
      if (!element.isActive) {
        return [];
      }
      const cache = this.schemaCache.get();
      if (!cache || cache.allRecordTypes.length === 0) {
        return [new NoSchemaDownloadedNode()];
      }

      let recordTypes = cache.allRecordTypes.filter((recordType) => recordType.supportsSuiteQL);
      if (this.filterText) {
        recordTypes = recordTypes.filter((recordType) => this.recordTypeMatches(recordType, cache));
        if (recordTypes.length === 0) {
          return [new NoFilterMatchesNode(this.filterText)];
        }
      }

      return recordTypes
        .map((recordType) => new RecordTypeNode(element.profileId, recordType, Boolean(cache.schemas[recordType.id])))
        .sort((a, b) => a.recordType.label.localeCompare(b.recordType.label));
    }

    if (element instanceof RecordTypeNode) {
      const schema = this.schemaCache.get()?.schemas[element.recordType.id];
      if (!schema) {
        return [];
      }
      const fields = this.filterText ? this.matchingFields(element.recordType, schema.fields) : schema.fields;
      return fields
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((field) => new FieldNode(field));
    }

    return [];
  }

  private recordTypeMatches(recordType: RecordTypeInfo, cache: SchemaCacheFile): boolean {
    const filterText = this.filterText;
    if (!filterText) {
      return true;
    }
    if (matchesText(filterText, recordType.id, recordType.label)) {
      return true;
    }
    const schema = cache.schemas[recordType.id];
    return schema?.fields.some((field) => matchesText(filterText, field.name, field.label)) ?? false;
  }

  private matchingFields(recordType: RecordTypeInfo, fields: FieldSchema[]): FieldSchema[] {
    const filterText = this.filterText;
    if (!filterText) {
      return fields;
    }
    if (matchesText(filterText, recordType.id, recordType.label)) {
      return fields; // matched by the table's own name/id — show all of its fields
    }
    return fields.filter((field) => matchesText(filterText, field.name, field.label));
  }
}
