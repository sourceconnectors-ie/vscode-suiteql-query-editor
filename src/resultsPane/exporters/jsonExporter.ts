import { coerceRow, type CoerceOptions, type FieldTypeInfo } from "@monty-nabil/netsuite-api-client-ts";

/**
 * NetSuite's SuiteQL REST endpoint returns every column value as a string, regardless of
 * its real type — `fieldTypes` (see `buildFieldTypesForQuery` in
 * `../../schemaCache/columnTypeCoercion.ts`) coerces known columns back to actual JSON
 * numbers/booleans instead of exporting everything quoted. A column with no entry in
 * `fieldTypes` (an unrecognized data type, a join/alias/aggregate, or no active schema)
 * passes through unchanged. A value that fails to coerce (a schema/data mismatch) is left
 * as its original string and reported via `onCoercionWarning`, rather than failing export.
 */
export function toJson(
  rows: Array<Record<string, unknown>>,
  fieldTypes?: Map<string, FieldTypeInfo>,
  onCoercionWarning?: CoerceOptions["onCoercionWarning"],
): string {
  const output =
    fieldTypes && fieldTypes.size > 0 ? rows.map((row) => coerceRow(row, fieldTypes, { onCoercionWarning })) : rows;
  return JSON.stringify(output, null, 2);
}
