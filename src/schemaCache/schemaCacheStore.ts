import * as vscode from "vscode";
import type { SchemaCacheFile } from "./schemaCacheTypes.js";

/** Reads/writes one schema-cache JSON file per connection profile under global storage. */
export class SchemaCacheStore {
  /** Per-profile tail of pending writes/deletes, so overlapping ones land in call order instead of racing. */
  private readonly pendingWrites = new Map<string, Promise<void>>();

  constructor(private readonly globalStorageUri: vscode.Uri) {}

  private enqueueWrite(profileId: string, operation: () => Promise<void>): Promise<void> {
    const previous = this.pendingWrites.get(profileId) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(operation);
    this.pendingWrites.set(profileId, next);
    void next.finally(() => {
      if (this.pendingWrites.get(profileId) === next) {
        this.pendingWrites.delete(profileId);
      }
    }).catch(() => undefined);
    return next;
  }

  private directoryUri(): vscode.Uri {
    return vscode.Uri.joinPath(this.globalStorageUri, "schema-cache");
  }

  private fileUri(profileId: string): vscode.Uri {
    return vscode.Uri.joinPath(this.directoryUri(), `${profileId}.json`);
  }

  async load(profileId: string): Promise<SchemaCacheFile | undefined> {
    // Let any queued save/delete land first, so a load right after one never reads the file it replaces.
    await this.pendingWrites.get(profileId)?.catch(() => undefined);
    try {
      const bytes = await vscode.workspace.fs.readFile(this.fileUri(profileId));
      const parsed = JSON.parse(Buffer.from(bytes).toString("utf8")) as { formatVersion?: number };
      // formatVersion 1 (oa_tables/oa_columns-less shape) is discarded rather than migrated —
      // simplest to just re-download.
      if (parsed.formatVersion !== 2) {
        return undefined;
      }
      return parsed as SchemaCacheFile;
    } catch {
      return undefined;
    }
  }

  save(cache: SchemaCacheFile): Promise<void> {
    // Serialized now, not at write time, so a later mutation of `cache` by the caller can't leak into this write.
    const bytes = Buffer.from(JSON.stringify(cache, null, 2), "utf8");
    return this.enqueueWrite(cache.profileId, async () => {
      await vscode.workspace.fs.createDirectory(this.directoryUri());
      await vscode.workspace.fs.writeFile(this.fileUri(cache.profileId), bytes);
    });
  }

  delete(profileId: string): Promise<void> {
    return this.enqueueWrite(profileId, async () => {
      try {
        await vscode.workspace.fs.delete(this.fileUri(profileId));
      } catch {
        // Nothing to delete.
      }
    });
  }
}
