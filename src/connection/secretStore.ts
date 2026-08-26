import * as vscode from "vscode";

const CONSUMER_SECRET_SUFFIX = "consumerSecret";
const TOKEN_SECRET_SUFFIX = "tokenSecret";

function secretKey(profileId: string, suffix: string): string {
  return `suiteql.secret.${profileId}.${suffix}`;
}

/** Wraps `vscode.SecretStorage` for the two OAuth1 TBA secrets a connection profile needs. */
export class SecretStore {
  constructor(private readonly secrets: vscode.SecretStorage) {}

  async store(profileId: string, consumerSecret: string, tokenSecret: string): Promise<void> {
    await this.secrets.store(secretKey(profileId, CONSUMER_SECRET_SUFFIX), consumerSecret);
    await this.secrets.store(secretKey(profileId, TOKEN_SECRET_SUFFIX), tokenSecret);
  }

  async get(profileId: string): Promise<{ consumerSecret: string; tokenSecret: string } | undefined> {
    const consumerSecret = await this.secrets.get(secretKey(profileId, CONSUMER_SECRET_SUFFIX));
    const tokenSecret = await this.secrets.get(secretKey(profileId, TOKEN_SECRET_SUFFIX));
    if (!consumerSecret || !tokenSecret) {
      return undefined;
    }
    return { consumerSecret, tokenSecret };
  }

  async delete(profileId: string): Promise<void> {
    await this.secrets.delete(secretKey(profileId, CONSUMER_SECRET_SUFFIX));
    await this.secrets.delete(secretKey(profileId, TOKEN_SECRET_SUFFIX));
  }
}
