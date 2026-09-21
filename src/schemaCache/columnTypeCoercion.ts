import type { FieldTypeInfo, CoercibleType } from "../../vendor/netsuite-api-client-ts/index.js";
import { buildAliasMap } from "../completion/scopeHeuristic.js";
import type { SchemaCacheFile } from "./schemaCacheTypes.js";

/**
 * Records Catalog's own field `dataType` values (see `restletFieldMapping.ts`), mapped to
 * the vendor coercion library's simpler string/integer/number/boolean vocabulary. Built
 * from what a live account's schema actually contains — see the "N/A" (SUBLIST) case
 * `mapRcFieldToColumnInfo` already excludes entirely, since those aren't queryable at all.
 *
 * `KEY` (an internal-ID/reference field) maps to `integer`: NetSuite always returns these
 * as numeric-looking strings over SuiteQL, even though the underlying field is a
 * reference to another record rather than a plain number.
 */
const RECORDS_CATALOG_TYPE_MAP: Record<string, CoercibleType> = {
  INTEGER: "integer",
  KEY: "integer",
  FLOAT: "number",
  CURRENCY: "number",
  CURRENCY_HIGH_PRECISION: "number",
  PERCENT: "number",
  BOOLEAN: "boolean",
  STRING: "string",
  CLOBTEXT: "string",
  DATE: "string",
  DATETIME: "string",
  DURATION: "string",
};

/**
 * Maps a Records Catalog `dataType` to a {@link CoercibleType}, or `undefined` for a value
 * this hasn't seen before — left as the raw string SuiteQL already returned rather than
 * guessing at how to coerce it.
 */
export function toCoercibleType(recordsCatalogDataType: string): CoercibleType | undefined {
  return RECORDS_CATALOG_TYPE_MAP[recordsCatalogDataType.toUpperCase()];
}

/**
 * Builds a column-name -> type map for coercing a query's result rows, scoped to just the
 * tables the query actually references (the same FROM/JOIN heuristic the completion
 * provider uses — see `scopeHeuristic.ts`; not a real SQL parser). A column name that
 * appears in more than one referenced table (a join) takes whichever table's type was
 * seen last, in FROM/JOIN order — a reasonable default given a SuiteQL result column
 * isn't otherwise attributable to a specific table without actually parsing the query.
 */
export function buildFieldTypesForQuery(queryText: string, cache: SchemaCacheFile): Map<string, FieldTypeInfo> {
  const tableNames = new Set(Object.values(buildAliasMap(queryText)));

  const fieldTypes = new Map<string, FieldTypeInfo>();
  for (const tableName of tableNames) {
    const schema = cache.schemas[tableName];
    if (!schema) {
      continue;
    }
    for (const column of schema.columns) {
      const dataType = toCoercibleType(column.dataType);
      if (dataType) {
        fieldTypes.set(column.columnName.toLowerCase(), { dataType });
      }
    }
  }
  return fieldTypes;
}
