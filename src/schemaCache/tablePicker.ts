import * as vscode from "vscode";
import type { SuiteQLTableInfo } from "./schemaCacheTypes.js";

/** Pre-checked by default the first time a connection's schema is built. Matched case-insensitively. */
export const COMMON_TABLES: readonly string[] = [
  "customer",
  "transaction",
  "transactionline",
  "salesorder",
  "invoice",
  "vendor",
  "vendorbill",
  "item",
  "inventoryitem",
  "employee",
  "account",
  "contact",
  "opportunity",
  "estimate",
  "purchaseorder",
  "creditmemo",
  "journalentry",
  "location",
  "subsidiary",
  "department",
  "classification",
];

const COMMON_TABLES_LOWER = new Set(COMMON_TABLES.map((name) => name.toLowerCase()));

export interface TableQuickPickItem extends vscode.QuickPickItem {
  tableName: string;
}

/**
 * Shows a checkbox picker over every discoverable SuiteQL table. On a first run
 * (`alreadySelected` empty), the curated common set is pre-checked; on a later run,
 * whatever is already selected is pre-checked instead, so re-running this to add more
 * tables reads as "here's your current schema, add to it."
 *
 * A previously selected table that's missing from today's index (e.g. the publisher
 * failed to gather it on its last run, so it's listed under the index's `errors` rather
 * than `tableNames`) is still offered, pre-checked — otherwise it would silently drop out
 * of the selection, and its cached columns with it, just because the user clicked OK.
 * Selection matching is case-insensitive.
 *
 * Returns the full set of checked table names, or `undefined` if the user cancelled.
 */
export async function pickTables(
  allTables: SuiteQLTableInfo[],
  alreadySelected: ReadonlySet<string>,
): Promise<string[] | undefined> {
  const picked = await vscode.window.showQuickPick(buildTablePickerItems(allTables, alreadySelected), {
    canPickMany: true,
    placeHolder:
      alreadySelected.size === 0
        ? "Select tables to include (commonly-used tables are pre-checked)"
        : "Select tables to include (your current schema is pre-checked)",
    title: "SuiteQL: Choose Tables",
  });

  return picked?.map((item) => item.tableName);
}

/** The picker's items — split out from {@link pickTables} so it can be unit-tested without a UI. */
export function buildTablePickerItems(
  allTables: SuiteQLTableInfo[],
  alreadySelected: ReadonlySet<string>,
): TableQuickPickItem[] {
  const defaultToCommon = alreadySelected.size === 0;
  const selectedLower = new Set([...alreadySelected].map((name) => name.toLowerCase()));
  const indexedLower = new Set(allTables.map((table) => table.tableName.toLowerCase()));

  const items: TableQuickPickItem[] = allTables.map((table) => {
    const lower = table.tableName.toLowerCase();
    return {
      label: lower,
      picked: selectedLower.has(lower) || (defaultToCommon && COMMON_TABLES_LOWER.has(lower)),
      tableName: table.tableName,
    };
  });

  for (const tableName of alreadySelected) {
    const lower = tableName.toLowerCase();
    if (!indexedLower.has(lower)) {
      indexedLower.add(lower);
      items.push({ label: lower, description: "not in the current RESTlet index", picked: true, tableName });
    }
  }

  return items.sort((a, b) => a.label.localeCompare(b.label));
}
