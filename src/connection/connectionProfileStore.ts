import { randomUUID } from "node:crypto";
import * as vscode from "vscode";
import type { ConnectionProfile } from "./connectionProfile.js";

const SECTION = "suiteql";
const KEY = "connections";

/** CRUD over the `suiteql.connections` setting (non-secret connection profiles only). */
export class ConnectionProfileStore {
  getAll(): ConnectionProfile[] {
    return vscode.workspace.getConfiguration(SECTION).get<ConnectionProfile[]>(KEY, []);
  }

  get(id: string): ConnectionProfile | undefined {
    return this.getAll().find((profile) => profile.id === id);
  }

  async add(profile: Omit<ConnectionProfile, "id">): Promise<ConnectionProfile> {
    const created: ConnectionProfile = { ...profile, id: randomUUID() };
    const all = [...this.getAll(), created];
    await this.writeAll(all);
    return created;
  }

  async update(profile: ConnectionProfile): Promise<void> {
    const all = this.getAll().map((existing) => (existing.id === profile.id ? profile : existing));
    await this.writeAll(all);
  }

  async remove(id: string): Promise<void> {
    const all = this.getAll().filter((existing) => existing.id !== id);
    await this.writeAll(all);
  }

  private async writeAll(profiles: ConnectionProfile[]): Promise<void> {
    await vscode.workspace
      .getConfiguration(SECTION)
      .update(KEY, profiles, vscode.ConfigurationTarget.Global);
  }
}
