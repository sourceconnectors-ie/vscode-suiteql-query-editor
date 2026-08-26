import { parseSuiteQLConfig, SuiteQLConnector, type SuiteQLConfigInput } from "../../vendor/netsuite-api-client-ts/index.js";
import type { ActiveConnectionManager } from "./activeConnection.js";
import type { ConnectionProfile, ConnectionProfileInput } from "./connectionProfile.js";
import type { ConnectionProfileStore } from "./connectionProfileStore.js";
import type { SecretStore } from "./secretStore.js";

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

  /** Builds a throwaway connector and checks it — never persists anything. */
  async testConnection(input: ConnectionProfileInput): Promise<TestConnectionResult> {
    try {
      const config = parseSuiteQLConfig(this.toConfigInput(input));
      const connector = new SuiteQLConnector(config);
      const result = await connector.checkConnection();
      return { success: result.status === "success", message: result.message };
    } catch (error) {
      return { success: false, message: error instanceof Error ? error.message : String(error) };
    }
  }

  /** Persists a new profile + its secrets, then makes it the active connection. */
  async addConnectionAndActivate(input: ConnectionProfileInput): Promise<ConnectionProfile> {
    const profile = await this.profileStore.add({
      label: input.label,
      realm: input.realm,
      consumerKey: input.consumerKey,
      tokenKey: input.tokenKey,
    });
    await this.secretStore.store(profile.id, input.consumerSecret, input.tokenSecret);
    await this.activate(profile);
    return profile;
  }

  /** Activates an already-saved profile, disconnecting whatever was previously active. */
  async activate(profile: ConnectionProfile): Promise<void> {
    const secrets = await this.secretStore.get(profile.id);
    if (!secrets) {
      throw new Error(`No stored secrets found for connection "${profile.label}". Try re-adding it.`);
    }
    const config = parseSuiteQLConfig(this.toConfigInput({ ...profile, ...secrets }));
    const connector = new SuiteQLConnector(config);
    this.activeConnection.connect(profile, connector, config);
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
