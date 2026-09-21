import * as vscode from "vscode";
import { OperationCancelledError, Semaphore, type SuiteQLConfig } from "../../vendor/netsuite-api-client-ts/index.js";
import { logError, logWarning } from "../outputChannel.js";
import type { SchemaCacheStore } from "./schemaCacheStore.js";
import { emptySchemaCache, type SchemaCacheFile, type SuiteQLTableSchema } from "./schemaCacheTypes.js";
import { RestletSchemaDiscovery } from "./restletSchemaDiscovery.js";
import { pickTables } from "./tablePicker.js";

const MAX_CONCURRENT_METADATA_REQUESTS = 3;

export interface SchemaDownloadOutcome {
  cache: SchemaCacheFile;
  addedCount: number;
  failedCount: number;
  cancelled: boolean;
}

function isCancellation(error: unknown): boolean {
  return error instanceof OperationCancelledError;
}

/** Derives an `AbortSignal` from a `vscode.CancellationToken`, for passing into `RestletClient`. */
function toAbortSignal(token: vscode.CancellationToken): AbortSignal {
  const controller = new AbortController();
  if (token.isCancellationRequested) {
    controller.abort();
  } else {
    token.onCancellationRequested(() => controller.abort());
  }
  return controller.signal;
}

/**
 * Returns `true` when `cache` was populated from a different RESTlet endpoint than
 * `restletUrl` — its cached columns are then assumed stale and must not be reused.
 * A cache with no recorded `restletUrl` (pre-existing on disk from before this field was
 * tracked) is never considered stale by this check; it force-refreshes the first time its
 * endpoint changes from here on instead.
 */
export function isCacheStaleForEndpoint(cache: Pick<SchemaCacheFile, "restletUrl">, restletUrl: string): boolean {
  return cache.restletUrl !== undefined && cache.restletUrl !== restletUrl;
}

/**
 * Owns the additive "Add Tables to Schema" flow: fetch the table catalog (via a
 * per-connection RESTlet, see `RestletSchemaDiscovery`), show a checkbox picker, fetch
 * newly-checked tables' columns with bounded concurrency + retry, merge into the
 * per-connection cache, save. Already-cached tables are never re-fetched, and unchecking
 * a table only drops it from the selection/tree — it never disturbs anything else in the
 * cache. Callers must guard on `restletUrl` being set before calling in — this class
 * doesn't, since a connection with no RESTlet URL should never reach here.
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
    restletUrl: string,
  ): Promise<SchemaDownloadOutcome | undefined> {
    const discovery = new RestletSchemaDiscovery(config, restletUrl);
    const cache = await this.loadOrEmpty(profileId, realm);

    if (isCacheStaleForEndpoint(cache, restletUrl)) {
      // Columns came from a different endpoint — discard them so every selected table is
      // re-fetched below. `selectedTableNames` is kept: it's the user's intent (which
      // tables they want in the schema), not endpoint-specific data.
      logWarning(`RESTlet URL for connection "${profileId}" changed since the schema was last downloaded — discarding the cached columns.`);
      cache.schemas = {};
      cache.failedTables = [];
    }
    cache.restletUrl = restletUrl;

    const allTables = await discovery.getAllTables();
    cache.allTables = allTables;

    const alreadySelected = new Set(cache.selectedTableNames);
    const checked = await pickTables(allTables, alreadySelected);
    if (!checked) {
      return undefined;
    }

    const checkedKeys = new Set(checked.map((name) => name.toLowerCase()));
    const cachedKeys = new Set(Object.keys(cache.schemas));
    const toFetch = checked.filter((name) => !cachedKeys.has(name.toLowerCase()));

    for (const key of cachedKeys) {
      if (!checkedKeys.has(key)) {
        delete cache.schemas[key];
      }
    }
    cache.selectedTableNames = checked;
    cache.failedTables = cache.failedTables.filter((failure) => checkedKeys.has(failure.tableName.toLowerCase()));

    if (toFetch.length === 0) {
      cache.downloadedAt = new Date().toISOString();
      await this.cacheStore.save(cache);
      return { cache, addedCount: 0, failedCount: 0, cancelled: false };
    }

    return vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `SuiteQL: downloading schema for ${toFetch.length} table(s)`,
        cancellable: true,
      },
      async (progress, token) => {
        const signal = toAbortSignal(token);
        const semaphore = new Semaphore(MAX_CONCURRENT_METADATA_REQUESTS);
        let completed = 0;
        let addedCount = 0;
        let failedCount = 0;
        let cancelled = false;

        await Promise.all(
          toFetch.map((tableName) =>
            semaphore.run(async () => {
              if (signal.aborted) {
                cancelled = true;
                return;
              }
              try {
                const { columns, source } = await discovery.getColumnsForTable(tableName, signal);
                const schema: SuiteQLTableSchema = { table: { tableName }, columns, source };
                cache.schemas[tableName.toLowerCase()] = schema;
                addedCount += 1;
              } catch (error) {
                if (isCancellation(error)) {
                  cancelled = true;
                } else {
                  const message = error instanceof Error ? error.message : String(error);
                  cache.failedTables.push({ tableName, error: message });
                  logError(`Failed to download schema for table "${tableName}"`, error);
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
            `SuiteQL: downloaded ${addedCount} table schema(s); ${failedCount} failed (see the "SuiteQL" output channel).`,
          );
        }

        return { cache, addedCount, failedCount, cancelled };
      },
    );
  }
}
