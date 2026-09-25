import * as assert from "assert";
import * as crypto from "node:crypto";
import type * as vscode from "vscode";
import { getAuthMode } from "@monty-nabil/netsuite-api-client-ts";
import { ActiveConnectionManager } from "../connection/activeConnection.js";
import type { ConnectionProfile } from "../connection/connectionProfile.js";
import { ConnectionService } from "../connection/connectionService.js";
import type { ConnectionProfileStore } from "../connection/connectionProfileStore.js";
import { SecretStore } from "../connection/secretStore.js";

/**
 * A throwaway RSA key generated per run — never used against a real account. 2048 bits is
 * below NetSuite's real 3072/4096 requirement, which doesn't matter here: nothing signs
 * with it, the config layer only has to accept and carry it.
 */
const TEST_PRIVATE_KEY_PEM = crypto
  .generateKeyPairSync("rsa", { modulusLength: 2048 })
  .privateKey.export({ type: "pkcs8", format: "pem" }) as string;

function fakeSecretStorage(): vscode.SecretStorage {
  const store = new Map<string, string>();
  return {
    get: async (key: string) => store.get(key),
    store: async (key: string, value: string) => void store.set(key, value),
    delete: async (key: string) => void store.delete(key),
    keys: async () => [...store.keys()],
    onDidChange: (() => ({ dispose: () => undefined })) as unknown as vscode.SecretStorage["onDidChange"],
  } as unknown as vscode.SecretStorage;
}

/** `activate` never reads the profile store — it's handed the profile directly. */
const unusedProfileStore = {} as ConnectionProfileStore;

function makeService(): { service: ConnectionService; secrets: SecretStore; active: ActiveConnectionManager } {
  const secrets = new SecretStore(fakeSecretStorage());
  const active = new ActiveConnectionManager();
  return { service: new ConnectionService(unusedProfileStore, secrets, active), secrets, active };
}

suite("ConnectionService.activate", () => {
  test("connects a profile saved before M2M support, with no authType", async () => {
    // The back-compat guarantee, automated: this is exactly what sits in the settings.json
    // of anyone who used the extension before OAuth 2.0 existed.
    const { service, secrets, active } = makeService();
    const legacy = {
      id: "legacy-1",
      label: "Prod",
      realm: "1234567",
      consumerKey: "ck",
      tokenKey: "tk",
    } as ConnectionProfile;
    await secrets.store("legacy-1", { authType: "tba", consumerSecret: "cs", tokenSecret: "ts" });

    await service.activate(legacy);

    const connection = active.get();
    assert.ok(connection, "expected the legacy profile to connect");
    assert.strictEqual(getAuthMode(connection.config), "tba");
    assert.strictEqual(connection.config.consumerKey, "ck");
    assert.strictEqual(connection.config.tokenSecret, "ts");
  });

  test("builds an M2M config, defaulting the algorithm to PS256", async () => {
    const { service, secrets, active } = makeService();
    const profile: ConnectionProfile = {
      id: "m2m-1",
      authType: "m2m",
      label: "Sandbox",
      realm: "1234567_SB1",
      clientId: "client",
      certificateId: "cert",
    };
    await secrets.store("m2m-1", { authType: "m2m", privateKey: TEST_PRIVATE_KEY_PEM });

    await service.activate(profile);

    const connection = active.get();
    assert.ok(connection);
    assert.strictEqual(getAuthMode(connection.config), "m2m");
    assert.strictEqual(connection.config.clientId, "client");
    assert.strictEqual(connection.config.certificateId, "cert");
    // Omitted in the profile, so the library's default applies rather than the extension
    // inventing one of its own.
    assert.strictEqual(connection.config.jwtAlgorithm, "PS256");
    // The TBA arm must be entirely absent: the library rejects a config carrying both.
    assert.strictEqual(connection.config.consumerKey, undefined);
    assert.strictEqual(connection.config.tokenKey, undefined);
  });

  test("carries an explicitly chosen algorithm through", async () => {
    const { service, secrets, active } = makeService();
    await secrets.store("m2m-2", { authType: "m2m", privateKey: TEST_PRIVATE_KEY_PEM });

    await service.activate({
      id: "m2m-2",
      authType: "m2m",
      label: "S",
      realm: "1",
      clientId: "c",
      certificateId: "x",
      jwtAlgorithm: "ES384",
    });

    assert.strictEqual(active.get()?.config.jwtAlgorithm, "ES384");
  });

  test("reuses one query client for the whole connection", async () => {
    // Under M2M the access token is cached per client instance, so handing out a new one
    // per query would mean a token exchange per query.
    const { service, secrets, active } = makeService();
    await secrets.store("m2m-3", { authType: "m2m", privateKey: TEST_PRIVATE_KEY_PEM });
    await service.activate({
      id: "m2m-3",
      authType: "m2m",
      label: "S",
      realm: "1",
      clientId: "c",
      certificateId: "x",
    });

    const connection = active.get();
    assert.ok(connection);
    assert.strictEqual(connection.client, active.get()?.client);
    assert.strictEqual(connection.getRestletClient(), connection.getRestletClient());
    // Separate instances: the two need different OAuth2 scopes, so they can't share a token.
    assert.notStrictEqual(connection.client as unknown, connection.getRestletClient() as unknown);
  });

  test("reports missing credentials instead of building a half-formed config", async () => {
    const { service } = makeService();
    await assert.rejects(
      () =>
        service.activate({
          id: "nope",
          authType: "m2m",
          label: "Missing",
          realm: "1",
          clientId: "c",
          certificateId: "x",
        }),
      /No stored secrets found/,
    );
  });

  test("won't fall back to the other method's stored credentials", async () => {
    // Someone switches a profile to M2M by hand in settings.json, leaving the old TBA
    // secrets behind. Because the lookup is keyed by the profile's declared method, the
    // stale pair is never found — so this reports missing credentials rather than quietly
    // connecting with credentials the profile no longer claims to use.
    const { service, secrets, active } = makeService();
    await secrets.store("mismatch", { authType: "tba", consumerSecret: "cs", tokenSecret: "ts" });

    await assert.rejects(
      () =>
        service.activate({
          id: "mismatch",
          authType: "m2m",
          label: "Mismatched",
          realm: "1",
          clientId: "c",
          certificateId: "x",
        }),
      /No stored secrets found/,
    );
    assert.strictEqual(active.get(), undefined, "nothing should have been activated");
  });
});
