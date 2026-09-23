import * as vscode from "vscode";
import type { ActiveConnectionManager } from "../connection/activeConnection.js";
import type { SchemaCacheStore } from "./schemaCacheStore.js";
import type { SchemaCacheFile } from "./schemaCacheTypes.js";
import { isCacheStaleForEndpoint } from "./schemaDownloadService.js";

/**
 * Holds the active connection's schema cache in memory, shared by the object explorer
 * tree and the completion provider so neither has to independently decide when to load
 * it from disk. Loads eagerly whenever the active connection changes — not on first tree
 * expansion — so completions work even if the object explorer view was never opened.
 */
export class ActiveSchemaCache {
  private cache: SchemaCacheFile | undefined;
  /** Bumped by every `set()` and every connection change, so a slower disk load can't overwrite a newer value. */
  private generation = 0;
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  readonly onDidChange = this.changeEmitter.event;

  constructor(
    private readonly activeConnection: ActiveConnectionManager,
    private readonly cacheStore: SchemaCacheStore,
  ) {
    this.activeConnection.onDidChangeActiveConnection((active) => {
      this.generation += 1;
      this.cache = undefined;
      this.changeEmitter.fire();
      if (active) {
        void this.load(active.profile.id);
      }
    });
  }

  private async load(profileId: string): Promise<void> {
    const generation = this.generation;
    const loaded = await this.cacheStore.load(profileId);
    if (generation !== this.generation) {
      return; // the active connection changed again, or `set()` ran, while this load was in flight
    }
    const restletUrl = this.activeConnection.get()?.profile.restletUrl;
    if (loaded && restletUrl && isCacheStaleForEndpoint(loaded, restletUrl)) {
      return; // gathered from a different RESTlet endpoint than this connection now uses
    }
    this.cache = loaded;
    this.changeEmitter.fire();
  }

  get(): SchemaCacheFile | undefined {
    return this.cache;
  }

  set(cache: SchemaCacheFile): void {
    this.generation += 1;
    this.cache = cache;
    this.changeEmitter.fire();
  }
}
