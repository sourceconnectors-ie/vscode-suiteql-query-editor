import type { RecordSchema } from "./schema-discovery.js";

export type CoercibleType = "string" | "integer" | "number" | "boolean";

export interface FieldTypeInfo {
  dataType: CoercibleType;
}

const TYPE_ALIASES: Record<string, CoercibleType> = {
  string: "string",
  integer: "integer",
  int: "integer",
  number: "number",
  double: "number",
  float: "number",
  boolean: "boolean",
  bool: "boolean",
};

/** Resolves a type name (case-insensitive, aliases included) to a {@link CoercibleType}, or `undefined` if unrecognized. */
export function normalizeCoercibleType(type: string): CoercibleType | undefined {
  return TYPE_ALIASES[type.toLowerCase()];
}

const BOOLEAN_LOOKUP: Record<string, boolean> = { t: true, f: false };

/**
 * Builds a lowercased-column-name -> type map from a {@link RecordSchema}.
 *
 * Object/array-typed fields (NetSuite REST reference/sublist fields) are excluded:
 * SuiteQL returns a flat scalar ID for those columns, so mapping them as "object"
 * would produce a rule that can never apply.
 *
 * Column matching is case-insensitive: REST field names are camelCase while SuiteQL
 * result columns are lowercase.
 */
export function buildFieldTypeMap(
  schema: RecordSchema,
  overrides?: Partial<Record<string, CoercibleType>>,
): Map<string, FieldTypeInfo> {
  const map = new Map<string, FieldTypeInfo>();

  for (const field of schema.fields) {
    if (field.dataType === "object" || field.dataType === "array") {
      continue;
    }
    if (isCoercibleType(field.dataType)) {
      map.set(field.name.toLowerCase(), { dataType: field.dataType });
    }
  }

  if (overrides) {
    for (const [column, dataType] of Object.entries(overrides)) {
      if (dataType) {
        map.set(column.toLowerCase(), { dataType });
      }
    }
  }

  return map;
}

function isCoercibleType(value: string): value is CoercibleType {
  return value === "string" || value === "integer" || value === "number" || value === "boolean";
}

export interface CoerceOptions {
  onCoercionWarning?: (message: string, details: Record<string, unknown>) => void;
}

/**
 * Returns the subset of `row`'s own keys that have no entry in `fieldTypes` —
 * columns coercion cannot apply to (joins, aliases, aggregates, or a field the
 * discovered schema simply doesn't cover).
 */
export function getUnmappedColumns(row: Record<string, unknown>, fieldTypes: Map<string, FieldTypeInfo>): string[] {
  return Object.keys(row).filter((column) => !fieldTypes.has(column.toLowerCase()));
}

/**
 * Coerces a SuiteQL result row's string values into typed JS values, using a
 * column-name -> type map built by {@link buildFieldTypeMap}. Returns a new object;
 * never mutates `row`.
 *
 * Only keys actually present on `row` are touched — NetSuite omits null-valued columns
 * from the row entirely rather than sending `""`, so "key absent" and "key present as
 * empty string" are distinct states, and only the latter is coerced to `null`. Columns
 * present on `row` but absent from `fieldTypes` are passed through unchanged.
 */
export function coerceRow(
  row: Record<string, unknown>,
  fieldTypes: Map<string, FieldTypeInfo>,
  options?: CoerceOptions,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [column, value] of Object.entries(row)) {
    const fieldType = fieldTypes.get(column.toLowerCase());
    result[column] = fieldType ? coerceValue(column, value, fieldType.dataType, options) : value;
  }

  return result;
}

function coerceValue(
  column: string,
  value: unknown,
  dataType: CoercibleType,
  options?: CoerceOptions,
): unknown {
  // Defensive: if SuiteQL ever returns a non-string value, don't run string-oriented
  // coercion logic against it — just pass it through.
  if (typeof value !== "string") {
    return value;
  }

  if (value === "") {
    return null;
  }

  switch (dataType) {
    case "integer":
    case "number": {
      const parsed = Number(value);
      if (Number.isNaN(parsed)) {
        options?.onCoercionWarning?.(`Could not coerce column "${column}" to ${dataType}`, {
          column,
          value,
          dataType,
        });
        return value;
      }
      return parsed;
    }
    case "boolean": {
      const normalized = BOOLEAN_LOOKUP[value.toLowerCase()];
      if (normalized === undefined) {
        options?.onCoercionWarning?.(`Unrecognized boolean value for column "${column}"`, {
          column,
          value,
          dataType,
        });
        return value;
      }
      return normalized;
    }
    case "string":
    default:
      return value;
  }
}
