import type { RecordSchema, RecordTypeInfo } from "../../vendor/netsuite-api-client-ts/index.js";

/** One JSON document per connection profile, persisted under the extension's global storage. */
export interface SchemaCacheFile {
  formatVersion: 1;
  profileId: string;
  realm: string;
  downloadedAt: string;
  /** Full catalog list — drives the picker and the "not yet added" tree placeholders. */
  allRecordTypes: RecordTypeInfo[];
  /** What the user has chosen to include, across all runs of the add-record-types flow. */
  selectedRecordTypeIds: string[];
  /** Successfully fetched schemas, keyed by record type id. Only ever grows via merge. */
  schemas: Record<string, RecordSchema>;
  failedRecordTypes: Array<{ id: string; error: string }>;
}

export function emptySchemaCache(profileId: string, realm: string): SchemaCacheFile {
  return {
    formatVersion: 1,
    profileId,
    realm,
    downloadedAt: new Date(0).toISOString(),
    allRecordTypes: [],
    selectedRecordTypeIds: [],
    schemas: {},
    failedRecordTypes: [],
  };
}
