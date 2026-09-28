/**
 * A SuiteQL-queryable table — what can actually appear after `FROM` in a SuiteQL query.
 * Discovered entirely via a per-connection RESTlet (see `ConnectionProfile.restletUrl`),
 * whose catalog already includes SuiteQL-only generic tables (`transaction`/
 * `transactionline`/...) since it's gathered from NetSuite's internal Records Catalog
 * backend. See `restletSchemaDiscovery.ts` for the full mechanism.
 */
export interface SuiteQLTableInfo {
  tableName: string;
}

/** A column of a SuiteQL table. `dataType` is best-effort: the Records Catalog backing the RESTlet doesn't expose real data types, only "unknown" unless the underlying field data happens to include one. */
export interface SuiteQLColumnInfo {
  columnName: string;
  dataType: string;
  maxLength?: number;
  precision?: number;
  scale?: number;
  description?: string;
  isRequired?: boolean;
  isCustom?: boolean;
}

export interface SuiteQLTableSchema {
  table: SuiteQLTableInfo;
  columns: SuiteQLColumnInfo[];
  source: "restlet";
}

/** One JSON document per connection profile, persisted under the extension's global storage. */
export interface SchemaCacheFile {
  formatVersion: 2;
  profileId: string;
  realm: string;
  downloadedAt: string;
  /**
   * The RESTlet URL `schemas`/`allTables` were gathered from. `undefined` for a cache
   * written before this field existed — see `isCacheStaleForEndpoint` in
   * `schemaDownloadService.ts`, the only place this is compared against a connection's
   * *current* RESTlet URL to decide whether the cached columns are stale.
   */
  restletUrl?: string;
  /** Full catalog list — drives the picker and the "not yet added" tree placeholders. */
  allTables: SuiteQLTableInfo[];
  /** What the user has chosen to include, across all runs of the add-tables flow. */
  selectedTableNames: string[];
  /** Successfully fetched schemas, keyed by lowercased table name. Only ever grows via merge. */
  schemas: Record<string, SuiteQLTableSchema>;
  failedTables: Array<{ tableName: string; error: string }>;
}

export function emptySchemaCache(profileId: string, realm: string): SchemaCacheFile {
  return {
    formatVersion: 2,
    profileId,
    realm,
    downloadedAt: new Date(0).toISOString(),
    allTables: [],
    selectedTableNames: [],
    schemas: {},
    failedTables: [],
  };
}

/**
 * Looks a table up in `cache.schemas` by its lowercased name, own keys only. `schemas` comes
 * straight from `JSON.parse`, so it's a plain object: a bare `schemas[name]` for a name like
 * `constructor` or `__proto__` (typed after `FROM`, or as an alias before a `.`) returns an
 * `Object.prototype` member instead of `undefined`, and dereferencing its `.columns` throws.
 */
export function getTableSchema(cache: Pick<SchemaCacheFile, "schemas">, lowerTableName: string): SuiteQLTableSchema | undefined {
  return Object.hasOwn(cache.schemas, lowerTableName) ? cache.schemas[lowerTableName] : undefined;
}

/** Stores a schema as an own data property — see `getTableSchema` for why plain assignment isn't safe for every key. */
export function setTableSchema(cache: Pick<SchemaCacheFile, "schemas">, lowerTableName: string, schema: SuiteQLTableSchema): void {
  Object.defineProperty(cache.schemas, lowerTableName, { value: schema, writable: true, enumerable: true, configurable: true });
}
