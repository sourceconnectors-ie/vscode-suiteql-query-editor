import * as vscode from "vscode";
import { RestletClient, SuiteQLClient, type SuiteQLConfig } from "@monty-nabil/netsuite-api-client-ts";
import type { ConnectionProfile } from "./connectionProfile.js";

export interface ActiveConnection {
  profile: ConnectionProfile;
  /** Resolved config, kept so callers that genuinely need their own client can build one. */
  config: SuiteQLConfig;
  /**
   * Query client for this connection, built once and reused for its whole lifetime.
   *
   * Reuse is not just tidiness: under OAuth 2.0 M2M the access token is cached *per client
   * instance*, so constructing one per query — as the results pane used to — would sign a
   * fresh JWT and round-trip the token endpoint on every single query.
   */
  client: SuiteQLClient;
  /**
   * RESTlet client for schema discovery, created on first use.
   *
   * Deliberately a separate instance from `client`: the two need different OAuth2 scopes
   * ("restlets" vs "rest_webservices"), so they cannot share a cached token.
   */
  getRestletClient(): RestletClient;
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

  connect(profile: ConnectionProfile, config: SuiteQLConfig): ActiveConnection {
    this.disconnect();
    this.epoch += 1;

    // Held in this closure rather than on the object so it's discarded with the
    // connection: a token cached for one account must never outlive a switch to another.
    let restletClient: RestletClient | undefined;

    this.current = {
      profile,
      config,
      client: new SuiteQLClient(config),
      getRestletClient: () => (restletClient ??= new RestletClient(config)),
      epoch: this.epoch,
    };
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
