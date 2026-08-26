import * as vscode from "vscode";
import type { SchemaCacheFile } from "./schemaCacheTypes.js";

/** Reads/writes one schema-cache JSON file per connection profile under global storage. */
export class SchemaCacheStore {
  constructor(private readonly globalStorageUri: vscode.Uri) {}

  private directoryUri(): vscode.Uri {
    return vscode.Uri.joinPath(this.globalStorageUri, "schema-cache");
  }

  private fileUri(profileId: string): vscode.Uri {
    return vscode.Uri.joinPath(this.directoryUri(), `${profileId}.json`);
  }

  async load(profileId: string): Promise<SchemaCacheFile | undefined> {
    try {
      const bytes = await vscode.workspace.fs.readFile(this.fileUri(profileId));
      return JSON.parse(Buffer.from(bytes).toString("utf8")) as SchemaCacheFile;
    } catch {
      return undefined;
    }
  }

  async save(cache: SchemaCacheFile): Promise<void> {
    await vscode.workspace.fs.createDirectory(this.directoryUri());
    const bytes = Buffer.from(JSON.stringify(cache, null, 2), "utf8");
    await vscode.workspace.fs.writeFile(this.fileUri(cache.profileId), bytes);
  }

  async delete(profileId: string): Promise<void> {
    try {
      await vscode.workspace.fs.delete(this.fileUri(profileId));
    } catch {
      // Nothing to delete.
    }
  }
}
