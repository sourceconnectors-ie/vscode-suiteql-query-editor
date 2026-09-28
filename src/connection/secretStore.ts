import * as vscode from "vscode";
import type { AuthType } from "./connectionProfile.js";

const CONSUMER_SECRET_SUFFIX = "consumerSecret";
const TOKEN_SECRET_SUFFIX = "tokenSecret";
const PRIVATE_KEY_SUFFIX = "privateKey";

/** Every suffix a profile can own, so deletion doesn't need to know the auth type. */
const ALL_SUFFIXES = [CONSUMER_SECRET_SUFFIX, TOKEN_SECRET_SUFFIX, PRIVATE_KEY_SUFFIX];

function secretKey(profileId: string, suffix: string): string {
  return `suiteql.secret.${profileId}.${suffix}`;
}

/** The secret half of a connection, split by auth method. Never persisted to settings. */
export type ConnectionSecrets =
  | { authType: "tba"; consumerSecret: string; tokenSecret: string }
  | { authType: "m2m"; privateKey: string };

/** Wraps `vscode.SecretStorage` for the credentials a connection profile needs. */
export class SecretStore {
  constructor(private readonly secrets: vscode.SecretStorage) {}

  async store(profileId: string, secrets: ConnectionSecrets): Promise<void> {
    if (secrets.authType === "m2m") {
      await this.secrets.store(secretKey(profileId, PRIVATE_KEY_SUFFIX), secrets.privateKey);
      return;
    }
    await this.secrets.store(secretKey(profileId, CONSUMER_SECRET_SUFFIX), secrets.consumerSecret);
    await this.secrets.store(secretKey(profileId, TOKEN_SECRET_SUFFIX), secrets.tokenSecret);
  }

  /**
   * Completeness is checked per auth method: an M2M profile holds only a private key, so
   * requiring the TBA pair would read it back as "no secrets at all" and send the user to
   * re-add a connection that was fine.
   */
  async get(profileId: string, authType: AuthType): Promise<ConnectionSecrets | undefined> {
    if (authType === "m2m") {
      const privateKey = await this.secrets.get(secretKey(profileId, PRIVATE_KEY_SUFFIX));
      return privateKey ? { authType: "m2m", privateKey } : undefined;
    }
    const consumerSecret = await this.secrets.get(secretKey(profileId, CONSUMER_SECRET_SUFFIX));
    const tokenSecret = await this.secrets.get(secretKey(profileId, TOKEN_SECRET_SUFFIX));
    if (!consumerSecret || !tokenSecret) {
      return undefined;
    }
    return { authType: "tba", consumerSecret, tokenSecret };
  }

  /**
   * Clears every suffix regardless of the profile's auth type — deletion must not leave a
   * stray credential behind just because the caller passed, or inferred, the wrong one.
   */
  async delete(profileId: string): Promise<void> {
    for (const suffix of ALL_SUFFIXES) {
      await this.secrets.delete(secretKey(profileId, suffix));
    }
  }
}
