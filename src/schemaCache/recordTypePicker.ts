import * as vscode from "vscode";
import type { RecordTypeInfo } from "../../vendor/netsuite-api-client-ts/index.js";

/** Pre-checked by default the first time a connection's schema is built. */
export const COMMON_RECORD_TYPES: readonly string[] = [
  "customer",
  "transaction",
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

interface RecordTypeQuickPickItem extends vscode.QuickPickItem {
  recordTypeId: string;
}

/**
 * Shows a checkbox picker over every discoverable record type. On a first run
 * (`alreadySelected` empty), the curated common set is pre-checked; on a later run,
 * whatever is already selected is pre-checked instead, so re-running this to add more
 * record types reads as "here's your current schema, add to it."
 *
 * Returns the full set of checked record type ids, or `undefined` if the user cancelled.
 */
export async function pickRecordTypes(
  allRecordTypes: RecordTypeInfo[],
  alreadySelected: ReadonlySet<string>,
): Promise<string[] | undefined> {
  const defaultToCommon = alreadySelected.size === 0;

  const items: RecordTypeQuickPickItem[] = allRecordTypes
    .filter((recordType) => recordType.supportsSuiteQL)
    .map((recordType) => ({
      label: recordType.label,
      description: recordType.id,
      picked: alreadySelected.has(recordType.id) || (defaultToCommon && COMMON_RECORD_TYPES.includes(recordType.id)),
      recordTypeId: recordType.id,
    }))
    .sort((a, b) => a.label.localeCompare(b.label));

  const picked = await vscode.window.showQuickPick(items, {
    canPickMany: true,
    matchOnDescription: true,
    placeHolder: defaultToCommon
      ? "Select record types to include (commonly-used types are pre-checked)"
      : "Select record types to include (your current schema is pre-checked)",
    title: "SuiteQL: Choose Record Types",
  });

  return picked?.map((item) => item.recordTypeId);
}
