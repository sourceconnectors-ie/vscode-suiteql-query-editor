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

interface TableQuickPickItem extends vscode.QuickPickItem {
  tableName: string;
}

/**
 * Shows a checkbox picker over every discoverable SuiteQL table. On a first run
 * (`alreadySelected` empty), the curated common set is pre-checked; on a later run,
 * whatever is already selected is pre-checked instead, so re-running this to add more
 * tables reads as "here's your current schema, add to it."
 *
 * Returns the full set of checked table names, or `undefined` if the user cancelled.
 */
export async function pickTables(
  allTables: SuiteQLTableInfo[],
  alreadySelected: ReadonlySet<string>,
): Promise<string[] | undefined> {
  const defaultToCommon = alreadySelected.size === 0;

  const items: TableQuickPickItem[] = allTables
    .map((table) => ({
      label: table.tableName.toLowerCase(),
      picked:
        alreadySelected.has(table.tableName) ||
        (defaultToCommon && COMMON_TABLES_LOWER.has(table.tableName.toLowerCase())),
      tableName: table.tableName,
    }))
    .sort((a, b) => a.label.localeCompare(b.label));

  const picked = await vscode.window.showQuickPick(items, {
    canPickMany: true,
    placeHolder: defaultToCommon
      ? "Select tables to include (commonly-used tables are pre-checked)"
      : "Select tables to include (your current schema is pre-checked)",
    title: "SuiteQL: Choose Tables",
  });

  return picked?.map((item) => item.tableName);
}
