import {
  OperationCancelledError,
  parseSuiteQLConfig,
  SuiteQLClient,
  SuiteQLHttpError,
  type SuiteQLConfigInput,
} from "@monty-nabil/netsuite-api-client-ts";
import type { ActiveConnectionManager } from "./activeConnection.js";
import {
  getAuthType,
  isM2mInput,
  isM2mProfile,
  validateBaseUrlOverride,
  validateRestletUrl,
  type ConnectionProfile,
  type ConnectionProfileInput,
} from "./connectionProfile.js";
import type { ConnectionProfileStore } from "./connectionProfileStore.js";
import type { ConnectionSecrets, SecretStore } from "./secretStore.js";

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
   * minutes, and honors `signal` so closing the dialog stops it. Any failure fails the
   * test — an HTTP 400 can't be told apart from a malformed request, so it's never taken as
   * proof the credentials work — but a 400 gets a hint that the role may simply lack access
   * to the table the test query reads.
   */
  async testConnection(input: ConnectionProfileInput, signal?: AbortSignal): Promise<TestConnectionResult> {
    try {
      const baseUrlError = validateBaseUrlOverride(input.baseUrlOverride);
      if (baseUrlError) {
        return { success: false, message: baseUrlError };
      }
      const config = parseSuiteQLConfig({ ...this.toConfigInput(input), queryTimeout: 30, maxRetries: 1 });
      await new SuiteQLClient(config).executeQuery(TEST_QUERY, 1, 0, signal);
      return { success: true, message: "Connection successful" };
    } catch (error) {
      if (error instanceof OperationCancelledError) {
        return { success: false, message: "Cancelled." };
      }
      if (error instanceof SuiteQLHttpError && error.statusCode === 400) {
        return {
          success: false,
          message: `${error.message} (the test query is "${TEST_QUERY}" — check that the role can access transactions).`,
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
    const baseUrlError = validateBaseUrlOverride(input.baseUrlOverride);
    if (baseUrlError) {
      throw new Error(baseUrlError);
    }
    const profile = await this.profileStore.add(
      isM2mInput(input)
        ? {
            authType: "m2m",
            label: input.label,
            realm: input.realm,
            clientId: input.clientId,
            certificateId: input.certificateId,
            jwtAlgorithm: input.jwtAlgorithm,
            restletUrl: input.restletUrl,
            ...(input.baseUrlOverride ? { baseUrlOverride: input.baseUrlOverride } : {}),
          }
        : {
            authType: "tba",
            label: input.label,
            realm: input.realm,
            consumerKey: input.consumerKey,
            tokenKey: input.tokenKey,
            restletUrl: input.restletUrl,
            ...(input.baseUrlOverride ? { baseUrlOverride: input.baseUrlOverride } : {}),
          },
    );
    await this.secretStore.store(
      profile.id,
      isM2mInput(input)
        ? { authType: "m2m", privateKey: input.privateKey }
        : { authType: "tba", consumerSecret: input.consumerSecret, tokenSecret: input.tokenSecret },
    );
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

  /**
   * Sets or clears a profile's server URL override. The URL is baked into the client's
   * config, so if this is the active connection it is reconnected to pick the change up.
   */
  async setBaseUrlOverride(id: string, baseUrlOverride: string | undefined): Promise<void> {
    const error = validateBaseUrlOverride(baseUrlOverride);
    if (error) {
      throw new Error(error);
    }
    const existing = this.profileStore.get(id);
    if (!existing) {
      throw new Error(`No saved connection found with id "${id}".`);
    }
    const updated: ConnectionProfile = { ...existing, baseUrlOverride };
    await this.profileStore.update(updated);
    if (this.activeConnection.get()?.profile.id === id) {
      await this.activate(updated);
    }
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
    const secrets = await this.secretStore.get(profile.id, getAuthType(profile));
    if (!shouldConnect()) {
      return false;
    }
    if (!secrets) {
      throw new Error(`No stored secrets found for connection "${profile.label}". Try re-adding it.`);
    }
    const config = parseSuiteQLConfig(this.toConfigFromProfile(profile, secrets));
    this.activeConnection.connect(profile, config);
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

  /**
   * Builds the library config from the dialog's collected input.
   *
   * Exactly one auth group may be populated — the library's schema rejects a config
   * carrying both, and a partially-filled group with a targeted message — so each arm
   * returns only its own fields rather than spreading everything and hoping.
   */
  private toConfigInput(input: ConnectionProfileInput): SuiteQLConfigInput {
    if (isM2mInput(input)) {
      return {
        realm: input.realm,
        clientId: input.clientId,
        certificateId: input.certificateId,
        privateKey: input.privateKey,
        // Omitted rather than defaulted here, so the library owns the default (PS256).
        ...(input.jwtAlgorithm ? { jwtAlgorithm: input.jwtAlgorithm } : {}),
        ...overrideField(input.baseUrlOverride),
      };
    }
    return {
      ...overrideField(input.baseUrlOverride),
      realm: input.realm,
      consumerKey: input.consumerKey,
      consumerSecret: input.consumerSecret,
      tokenKey: input.tokenKey,
      tokenSecret: input.tokenSecret,
    };
  }

  /** Same split as {@link toConfigInput}, for a saved profile recombined with its secrets. */
  private toConfigFromProfile(profile: ConnectionProfile, secrets: ConnectionSecrets): SuiteQLConfigInput {
    if (isM2mProfile(profile) && secrets.authType === "m2m") {
      return {
        realm: profile.realm,
        clientId: profile.clientId,
        certificateId: profile.certificateId,
        privateKey: secrets.privateKey,
        ...(profile.jwtAlgorithm ? { jwtAlgorithm: profile.jwtAlgorithm } : {}),
        ...overrideField(profile.baseUrlOverride),
      };
    }
    if (isM2mProfile(profile) || secrets.authType === "m2m") {
      // The stored secret doesn't match the profile's auth type — possible only if
      // settings.json was hand-edited after the credentials were saved.
      throw new Error(
        `Stored credentials for "${profile.label}" don't match its authentication method. Try re-adding it.`,
      );
    }
    return {
      ...overrideField(profile.baseUrlOverride),
      realm: profile.realm,
      consumerKey: profile.consumerKey,
      consumerSecret: secrets.consumerSecret,
      tokenKey: profile.tokenKey,
      tokenSecret: secrets.tokenSecret,
    };
  }
}

/** Omitted rather than `undefined`, so the library sees no override at all. */
function overrideField(value: string | undefined): { baseUrlOverride?: string } {
  return value?.trim() ? { baseUrlOverride: value.trim() } : {};
}
