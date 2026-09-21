import type { SuiteQLColumnInfo } from "./schemaCacheTypes.js";

/** Appends query params to a RESTlet URL that already has its own `?script=&deploy=` pair. */
export function appendQuery(url: string, params: Record<string, string>): string {
  const parsed = new URL(url);
  for (const [key, value] of Object.entries(params)) {
    parsed.searchParams.set(key, value);
  }
  return parsed.toString();
}

/**
 * Mirrors the Records Catalog's own field shape (`RcFieldLike` — undocumented beyond
 * `id`/`label`, surfaced through `netsuite-schema-publisher`'s RESTlet mostly as-is; see
 * `restletSchemaDiscovery.ts` for the full wire-contract context). Best-effort mapping:
 * `dataType` falls back to `"unknown"` when the field carries nothing recognizable.
 */
interface RcFieldLike {
  id?: string;
  label?: string;
  dataType?: string;
  type?: string;
  fieldType?: string;
  valueType?: string;
  mandatory?: boolean;
  [key: string]: unknown;
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.length > 0) {
      return value;
    }
  }
  return undefined;
}

/**
 * Records Catalog's own marker for a field with no scalar SQL type — in practice, a `SUBLIST`
 * field (an address book, a list of related records, etc.). Confirmed against a live account:
 * selecting one of these in SuiteQL fails with NetSuite's own `UNSUITABLE - Unsupported return
 * field type 'SUBLIST' for channel SEARCH`, so offering it as a queryable column (with any
 * dataType, blank or otherwise) is actively misleading — it's excluded below instead.
 */
const NOT_APPLICABLE_DATA_TYPE = "N/A";

export function mapRcFieldToColumnInfo(field: unknown): SuiteQLColumnInfo | undefined {
  if (typeof field !== "object" || field === null) {
    return undefined;
  }
  const rcField = field as RcFieldLike;
  if (typeof rcField.id !== "string" || rcField.id.length === 0) {
    return undefined;
  }
  // `type` is the Records Catalog *entry kind* ("RECORD_FIELD" for every ordinary field,
  // distinguishing it from a join/sublist entry) — not a per-field data type, so `dataType`
  // must be checked first. Confirmed against a real getRecordTypeDetail response; matches the
  // priority order suiteql-editor-tool-kit's own field mapping already uses for the same data.
  const dataType = firstString(rcField.dataType, rcField.type, rcField.fieldType, rcField.valueType) ?? "unknown";
  if (dataType === NOT_APPLICABLE_DATA_TYPE) {
    return undefined;
  }
  return {
    columnName: rcField.id,
    dataType,
    description: typeof rcField.label === "string" ? rcField.label : undefined,
    isRequired: typeof rcField.mandatory === "boolean" ? rcField.mandatory : undefined,
  };
}
