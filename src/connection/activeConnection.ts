import * as vscode from "vscode";
import type { SuiteQLConfig, SuiteQLConnector } from "../../vendor/netsuite-api-client-ts/index.js";
import type { ConnectionProfile } from "./connectionProfile.js";

export interface ActiveConnection {
  profile: ConnectionProfile;
  connector: SuiteQLConnector;
  /** Resolved config, kept alongside the connector so other services (schema download, query
   * execution) can build their own `RestletSchemaDiscovery`/`SuiteQLClient` instances as needed. */
  config: SuiteQLConfig;
  /** Bumped on every connect/disconnect transition; used to detect stale UI state (see resultsPane/queryEditor). */
  epoch: number;
}

/**
 * Tracks the single connection this extension allows to be active at any time.
 * Switching connections (or disconnecting) always goes through `disconnect()` first,
 * bumping `epoch` — anything holding a reference to the previous epoch can tell its
 * connection is now stale.
 */
export class ActiveConnectionManager {
  private current: ActiveConnection | undefined;
  private epoch = 0;

  private readonly changeEmitter = new vscode.EventEmitter<ActiveConnection | undefined>();
  readonly onDidChangeActiveConnection = this.changeEmitter.event;

  get(): ActiveConnection | undefined {
    return this.current;
  }

  connect(profile: ConnectionProfile, connector: SuiteQLConnector, config: SuiteQLConfig): ActiveConnection {
    this.disconnect();
    this.epoch += 1;
    this.current = { profile, connector, config, epoch: this.epoch };
    this.changeEmitter.fire(this.current);
    return this.current;
  }

  /** Updates the active connection's cached profile in place (e.g. after editing its RESTlet URL), without reconnecting. No-op if `profile` isn't the currently active one. */
  updateActiveProfile(profile: ConnectionProfile): void {
    if (!this.current || this.current.profile.id !== profile.id) {
      return;
    }
    if (JSON.stringify(this.current.profile) === JSON.stringify(profile)) {
      return; // nothing changed — don't invalidate anything tied to the current generation
    }
    this.current = { ...this.current, profile };
    this.changeEmitter.fire(this.current);
  }

  disconnect(): void {
    if (!this.current) {
      return;
    }
    this.epoch += 1;
    this.current = undefined;
    this.changeEmitter.fire(undefined);
  }

  dispose(): void {
    this.changeEmitter.dispose();
  }
}
