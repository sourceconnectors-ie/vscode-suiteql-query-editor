import * as vscode from "vscode";
import { OperationCancelledError, Semaphore, type RestletClient } from "@monty-nabil/netsuite-api-client-ts";
import { logError, logWarning } from "../outputChannel.js";
import type { SchemaCacheStore } from "./schemaCacheStore.js";
import { emptySchemaCache, setTableSchema, type SchemaCacheFile, type SuiteQLTableSchema } from "./schemaCacheTypes.js";
import { RestletSchemaDiscovery } from "./restletSchemaDiscovery.js";
import { pickTables } from "./tablePicker.js";

const MAX_CONCURRENT_METADATA_REQUESTS = 3;

export interface SchemaDownloadOutcome {
  cache: SchemaCacheFile;
  addedCount: number;
  failedCount: number;
  cancelled: boolean;
  /**
   * `true` when the connection this download was started for stopped being the live one
   * (disconnect, switch, reconnect, or a RESTlet URL change) before it finished. Nothing was
   * persisted in that case, and `cache` must not be applied anywhere.
   */
  superseded: boolean;
}

/** Ties a download to the connection generation it was started for — see `runInteractive`. */
export interface SchemaDownloadGuard {
  /** Whether the connection this download was started for is still the live one. */
  isCurrent(): boolean;
  /** Aborts once `isCurrent()` turns false, so in-flight RESTlet calls stop promptly too. */
  signal: AbortSignal;
}

function isCancellation(error: unknown): boolean {
  return error instanceof OperationCancelledError;
}

/** Derives an `AbortSignal` from a `vscode.CancellationToken`, for passing into `RestletClient`. */
function toAbortSignal(token: vscode.CancellationToken): { signal: AbortSignal; dispose(): void } {
  const controller = new AbortController();
  if (token.isCancellationRequested) {
    controller.abort();
    return { signal: controller.signal, dispose: () => undefined };
  }
  const listener = token.onCancellationRequested(() => controller.abort());
  return { signal: controller.signal, dispose: () => listener.dispose() };
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

  /**
   * Returns `undefined` only if the user cancelled the picker itself (before any fetch started).
   *
   * `guard` is re-checked after every await and immediately before every save: the cache
   * store is keyed only by profile id, so a download that outlived its connection (most
   * importantly, one still fetching from a RESTlet URL that has since been changed) would
   * otherwise overwrite the new generation's on-disk cache with stale columns — which a later
   * reconnect/restart would then load. A superseded run persists nothing and reports
   * `superseded: true` instead.
   */
  async runInteractive(
    profileId: string,
    realm: string,
    restletClient: RestletClient,
    restletUrl: string,
    guard: SchemaDownloadGuard,
  ): Promise<SchemaDownloadOutcome | undefined> {
    const superseded = (cache: SchemaCacheFile): SchemaDownloadOutcome => ({
      cache,
      addedCount: 0,
      failedCount: 0,
      cancelled: true,
      superseded: true,
    });

    const discovery = new RestletSchemaDiscovery(restletClient, restletUrl);
    const cache = await this.loadOrEmpty(profileId, realm);
    if (!guard.isCurrent()) {
      return superseded(cache);
    }

    if (isCacheStaleForEndpoint(cache, restletUrl)) {
      // Columns came from a different endpoint — discard them so every selected table is
      // re-fetched below. `selectedTableNames` is kept: it's the user's intent (which
      // tables they want in the schema), not endpoint-specific data.
      logWarning(`RESTlet URL for connection "${profileId}" changed since the schema was last downloaded — discarding the cached columns.`);
      cache.schemas = {};
      cache.failedTables = [];
    }
    cache.restletUrl = restletUrl;

    let allTables;
    try {
      allTables = await discovery.getAllTables(guard.signal);
    } catch (error) {
      if (isCancellation(error) && !guard.isCurrent()) {
        return superseded(cache);
      }
      throw error;
    }
    if (!guard.isCurrent()) {
      return superseded(cache);
    }
    cache.allTables = allTables;

    const alreadySelected = new Set(cache.selectedTableNames);
    const checked = await pickTables(allTables, alreadySelected);
    if (!checked) {
      return undefined;
    }
    if (!guard.isCurrent()) {
      return superseded(cache);
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
    // Keep only failures for tables that are still selected *and* not about to be retried —
    // a retried table's outcome below replaces its old entry rather than piling up next to it.
    const toFetchKeys = new Set(toFetch.map((name) => name.toLowerCase()));
    cache.failedTables = cache.failedTables.filter((failure) => {
      const key = failure.tableName.toLowerCase();
      return checkedKeys.has(key) && !toFetchKeys.has(key);
    });

    if (toFetch.length === 0) {
      cache.downloadedAt = new Date().toISOString();
      await this.cacheStore.save(cache);
      return { cache, addedCount: 0, failedCount: 0, cancelled: false, superseded: false };
    }

    return vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `SuiteQL: downloading schema for ${toFetch.length} table(s)`,
        cancellable: true,
      },
      async (progress, token) => {
        const tokenSignal = toAbortSignal(token);
        const signal = AbortSignal.any([tokenSignal.signal, guard.signal]);
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
                setTableSchema(cache, tableName.toLowerCase(), schema);
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
        tokenSignal.dispose();

        if (!guard.isCurrent()) {
          return superseded(cache);
        }
        cache.downloadedAt = new Date().toISOString();
        await this.cacheStore.save(cache);

        if (failedCount > 0) {
          logWarning(`Schema download finished with ${failedCount} failure(s) out of ${toFetch.length}.`);
          void vscode.window.showWarningMessage(
            `SuiteQL: downloaded ${addedCount} table schema(s); ${failedCount} failed (see the "SuiteQL" output channel).`,
          );
        }

        return { cache, addedCount, failedCount, cancelled, superseded: false };
      },
    );
  }
}
