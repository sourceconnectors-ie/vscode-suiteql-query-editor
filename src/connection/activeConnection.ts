import * as vscode from "vscode";
import type { SuiteQLConfig, SuiteQLConnector } from "../../vendor/netsuite-api-client-ts/index.js";
import type { ConnectionProfile } from "./connectionProfile.js";

export interface ActiveConnection {
  profile: ConnectionProfile;
  connector: SuiteQLConnector;
  /** Resolved config, kept alongside the connector so other services (schema download, query
   * execution) can build their own `SchemaDiscovery`/`SuiteQLClient` instances as needed. */
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
