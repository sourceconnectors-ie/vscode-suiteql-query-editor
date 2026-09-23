import {
  OperationCancelledError,
  parseSuiteQLConfig,
  SuiteQLClient,
  SuiteQLConnector,
  SuiteQLHttpError,
  type SuiteQLConfigInput,
} from "../../vendor/netsuite-api-client-ts/index.js";
import type { ActiveConnectionManager } from "./activeConnection.js";
import { validateRestletUrl, type ConnectionProfile, type ConnectionProfileInput } from "./connectionProfile.js";
import type { ConnectionProfileStore } from "./connectionProfileStore.js";
import type { SecretStore } from "./secretStore.js";

const TEST_QUERY = "SELECT id FROM transaction";

export interface TestConnectionResult {
  success: boolean;
  message: string;
}

/** Ties together profile storage, secret storage, and the single active connection. */
export class ConnectionService {
  constructor(
    private readonly profileStore: ConnectionProfileStore,
    private readonly secretStore: SecretStore,
    private readonly activeConnection: ActiveConnectionManager,
  ) {}

  /**
   * Sends one signed test query with a throwaway client — never persists anything.
   *
   * Uses the shortest allowed timeout and a single retry (rather than the query defaults
   * of 300s x 4 attempts) so a dead endpoint fails in about a minute instead of tens of
   * minutes, and honors `signal` so closing the dialog stops it. An HTTP 400 counts as
   * success: NetSuite rejects bad OAuth signatures/tokens with 401, so a 400 means the
   * credentials were accepted and only the test query itself failed — most often because
   * the role can't see the `transaction` table, which shouldn't block saving the connection.
   */
  async testConnection(input: ConnectionProfileInput, signal?: AbortSignal): Promise<TestConnectionResult> {
    try {
      const config = parseSuiteQLConfig({ ...this.toConfigInput(input), queryTimeout: 30, maxRetries: 1 });
      await new SuiteQLClient(config).executeQuery(TEST_QUERY, 1, 0, signal);
      return { success: true, message: "Connection successful" };
    } catch (error) {
      if (error instanceof OperationCancelledError) {
        return { success: false, message: "Cancelled." };
      }
      if (error instanceof SuiteQLHttpError && error.statusCode === 400) {
        return {
          success: true,
          message: `Authenticated, but the test query failed (${error.message}). The role may not have access to transactions.`,
        };
      }
      return { success: false, message: error instanceof Error ? error.message : String(error) };
    }
  }

  /** Persists a new profile + its secrets, then makes it the active connection. */
  async addConnectionAndActivate(input: ConnectionProfileInput): Promise<ConnectionProfile> {
    const restletUrlError = validateRestletUrl(input.restletUrl);
    if (restletUrlError) {
      throw new Error(restletUrlError);
    }
    const profile = await this.profileStore.add({
      label: input.label,
      realm: input.realm,
      consumerKey: input.consumerKey,
      tokenKey: input.tokenKey,
      restletUrl: input.restletUrl,
    });
    await this.secretStore.store(profile.id, input.consumerSecret, input.tokenSecret);
    await this.activate(profile);
    return profile;
  }

  /** Sets or clears a profile's RESTlet URL, keeping the active connection's cached copy in sync. */
  async setRestletUrl(id: string, restletUrl: string | undefined): Promise<void> {
    const restletUrlError = validateRestletUrl(restletUrl);
    if (restletUrlError) {
      throw new Error(restletUrlError);
    }
    const existing = this.profileStore.get(id);
    if (!existing) {
      throw new Error(`No saved connection found with id "${id}".`);
    }
    const updated: ConnectionProfile = { ...existing, restletUrl };
    await this.profileStore.update(updated);
    this.activeConnection.updateActiveProfile(updated);
  }

  /** Activates an already-saved profile, disconnecting whatever was previously active. */
  async activate(profile: ConnectionProfile): Promise<void> {
    await this.activateIf(profile, () => true);
  }

  /**
   * Like {@link activate}, but only connects if no connection became active while the
   * secrets were being read — for the silent startup restore, which must never override a
   * connection the user picked themselves in the meantime. Returns whether it connected.
   */
  async activateIfIdle(profile: ConnectionProfile): Promise<boolean> {
    return this.activateIf(profile, () => this.activeConnection.get() === undefined);
  }

  private async activateIf(profile: ConnectionProfile, shouldConnect: () => boolean): Promise<boolean> {
    const secrets = await this.secretStore.get(profile.id);
    if (!shouldConnect()) {
      return false;
    }
    if (!secrets) {
      throw new Error(`No stored secrets found for connection "${profile.label}". Try re-adding it.`);
    }
    const config = parseSuiteQLConfig(this.toConfigInput({ ...profile, ...secrets }));
    const connector = new SuiteQLConnector(config);
    this.activeConnection.connect(profile, connector, config);
    return true;
  }

  async removeConnection(id: string): Promise<void> {
    if (this.activeConnection.get()?.profile.id === id) {
      this.activeConnection.disconnect();
    }
    await this.profileStore.remove(id);
    await this.secretStore.delete(id);
  }

  getAllProfiles(): ConnectionProfile[] {
    return this.profileStore.getAll();
  }

  private toConfigInput(fields: {
    realm: string;
    consumerKey: string;
    consumerSecret: string;
    tokenKey: string;
    tokenSecret: string;
  }): SuiteQLConfigInput {
    return {
      realm: fields.realm,
      consumerKey: fields.consumerKey,
      consumerSecret: fields.consumerSecret,
      tokenKey: fields.tokenKey,
      tokenSecret: fields.tokenSecret,
    };
  }
}
