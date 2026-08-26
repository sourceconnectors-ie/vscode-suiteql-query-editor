import * as vscode from "vscode";
import {
  SchemaDiscovery,
  Semaphore,
  type RecordSchema,
  type SuiteQLConfig,
} from "../../vendor/netsuite-api-client-ts/index.js";
import { calculateBackoff, sleep } from "../../vendor/netsuite-api-client-ts/retry.js";
import { logError, logWarning } from "../outputChannel.js";
import { pickRecordTypes } from "./recordTypePicker.js";
import type { SchemaCacheStore } from "./schemaCacheStore.js";
import { emptySchemaCache, type SchemaCacheFile } from "./schemaCacheTypes.js";

const MAX_CONCURRENT_METADATA_REQUESTS = 3;
const MAX_RETRIES_PER_RECORD_TYPE = 3;
const INITIAL_RETRY_DELAY_SECONDS = 2;

export interface SchemaDownloadOutcome {
  cache: SchemaCacheFile;
  addedCount: number;
  failedCount: number;
  cancelled: boolean;
}

class OperationCancelledError extends Error {}

function isCancellation(error: unknown): boolean {
  return error instanceof OperationCancelledError;
}

/**
 * `SchemaDiscovery.getRecordSchema` has no retry logic of its own — retries here
 * (blanket, since metadata-catalog failures are rare and not worth classifying by
 * status code the way query execution is).
 */
async function fetchWithRetry(
  discovery: SchemaDiscovery,
  recordTypeId: string,
  token: vscode.CancellationToken | undefined,
): Promise<RecordSchema> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= MAX_RETRIES_PER_RECORD_TYPE; attempt++) {
    if (token?.isCancellationRequested) {
      throw new OperationCancelledError();
    }
    try {
      return await discovery.getRecordSchema(recordTypeId);
    } catch (error) {
      lastError = error;
      if (attempt >= MAX_RETRIES_PER_RECORD_TYPE) {
        break;
      }
      await sleep(calculateBackoff(attempt, INITIAL_RETRY_DELAY_SECONDS));
    }
  }
  throw lastError;
}

/**
 * Owns the additive "Add Record Types to Schema" flow: fetch the catalog, show a
 * checkbox picker, fetch newly-checked types with bounded concurrency + retry, merge
 * into the per-connection cache, save. Already-cached types are never re-fetched, and
 * unchecking a type only drops it from the selection/tree — it never disturbs anything
 * else in the cache.
 */
export class SchemaDownloadService {
  constructor(private readonly cacheStore: SchemaCacheStore) {}

  async loadOrEmpty(profileId: string, realm: string): Promise<SchemaCacheFile> {
    return (await this.cacheStore.load(profileId)) ?? emptySchemaCache(profileId, realm);
  }

  /** Returns `undefined` only if the user cancelled the picker itself (before any fetch started). */
  async runInteractive(
    profileId: string,
    realm: string,
    config: SuiteQLConfig,
  ): Promise<SchemaDownloadOutcome | undefined> {
    const discovery = new SchemaDiscovery(config);
    const cache = await this.loadOrEmpty(profileId, realm);

    const allRecordTypes = await discovery.getAllRecordTypes();
    cache.allRecordTypes = allRecordTypes;

    const alreadySelected = new Set(cache.selectedRecordTypeIds);
    const checked = await pickRecordTypes(allRecordTypes, alreadySelected);
    if (!checked) {
      return undefined;
    }

    const checkedSet = new Set(checked);
    const toFetch = checked.filter((id) => !cache.schemas[id]);
    for (const id of cache.selectedRecordTypeIds) {
      if (!checkedSet.has(id)) {
        delete cache.schemas[id];
      }
    }
    cache.selectedRecordTypeIds = checked;
    cache.failedRecordTypes = cache.failedRecordTypes.filter((failure) => checkedSet.has(failure.id));

    if (toFetch.length === 0) {
      cache.downloadedAt = new Date().toISOString();
      await this.cacheStore.save(cache);
      return { cache, addedCount: 0, failedCount: 0, cancelled: false };
    }

    return vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `SuiteQL: downloading schema for ${toFetch.length} record type(s)`,
        cancellable: true,
      },
      async (progress, token) => {
        const semaphore = new Semaphore(MAX_CONCURRENT_METADATA_REQUESTS);
        let completed = 0;
        let addedCount = 0;
        let failedCount = 0;
        let cancelled = false;

        await Promise.all(
          toFetch.map((recordTypeId) =>
            semaphore.run(async () => {
              if (token.isCancellationRequested) {
                cancelled = true;
                return;
              }
              try {
                cache.schemas[recordTypeId] = await fetchWithRetry(discovery, recordTypeId, token);
                addedCount += 1;
              } catch (error) {
                if (isCancellation(error)) {
                  cancelled = true;
                } else {
                  const message = error instanceof Error ? error.message : String(error);
                  cache.failedRecordTypes.push({ id: recordTypeId, error: message });
                  logError(`Failed to download schema for record type "${recordTypeId}"`, error);
                  failedCount += 1;
                }
              } finally {
                completed += 1;
                progress.report({ message: `${completed}/${toFetch.length}`, increment: 100 / toFetch.length });
              }
            }),
          ),
        );

        cache.downloadedAt = new Date().toISOString();
        await this.cacheStore.save(cache);

        if (failedCount > 0) {
          logWarning(`Schema download finished with ${failedCount} failure(s) out of ${toFetch.length}.`);
          void vscode.window.showWarningMessage(
            `SuiteQL: downloaded ${addedCount} record type schema(s); ${failedCount} failed (see the "SuiteQL" output channel).`,
          );
        }

        return { cache, addedCount, failedCount, cancelled };
      },
    );
  }

  /** Fetches and merges a single record type — backs the per-node "Add to Schema" action. */
  async addSingleRecordType(cache: SchemaCacheFile, config: SuiteQLConfig, recordTypeId: string): Promise<void> {
    const discovery = new SchemaDiscovery(config);
    cache.schemas[recordTypeId] = await fetchWithRetry(discovery, recordTypeId, undefined);
    if (!cache.selectedRecordTypeIds.includes(recordTypeId)) {
      cache.selectedRecordTypeIds.push(recordTypeId);
    }
    cache.failedRecordTypes = cache.failedRecordTypes.filter((failure) => failure.id !== recordTypeId);
    cache.downloadedAt = new Date().toISOString();
    await this.cacheStore.save(cache);
  }
}
