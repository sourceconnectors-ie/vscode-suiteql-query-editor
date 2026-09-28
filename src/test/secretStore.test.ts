import * as assert from "assert";
import type * as vscode from "vscode";
import { SecretStore } from "../connection/secretStore.js";

/**
 * In-memory stand-in for `vscode.SecretStorage`. `storedKeys` is deliberately kept beside
 * the storage rather than on it: the real interface has its own async `keys()`, and
 * shadowing it with a sync one wouldn't type-check.
 */
function fakeSecretStorage(): { storage: vscode.SecretStorage; storedKeys: () => string[] } {
  const store = new Map<string, string>();
  const storage = {
    get: async (key: string) => store.get(key),
    store: async (key: string, value: string) => void store.set(key, value),
    delete: async (key: string) => void store.delete(key),
    keys: async () => [...store.keys()],
    onDidChange: (() => ({ dispose: () => undefined })) as unknown as vscode.SecretStorage["onDidChange"],
  } as unknown as vscode.SecretStorage;
  return { storage, storedKeys: () => [...store.keys()] };
}

suite("SecretStore", () => {
  test("round-trips TBA secrets", async () => {
    const store = new SecretStore(fakeSecretStorage().storage);
    await store.store("p1", { authType: "tba", consumerSecret: "cs", tokenSecret: "ts" });

    assert.deepStrictEqual(await store.get("p1", "tba"), {
      authType: "tba",
      consumerSecret: "cs",
      tokenSecret: "ts",
    });
  });

  test("round-trips an M2M private key", async () => {
    const store = new SecretStore(fakeSecretStorage().storage);
    await store.store("p1", { authType: "m2m", privateKey: "PEM" });

    assert.deepStrictEqual(await store.get("p1", "m2m"), { authType: "m2m", privateKey: "PEM" });
  });

  test("reads back an M2M profile that stores only a private key", async () => {
    // The regression this guards: completeness used to require both TBA secrets, so an
    // M2M profile — which has neither — read back as "no secrets at all" and the user was
    // told to re-add a connection that was perfectly fine.
    const store = new SecretStore(fakeSecretStorage().storage);
    await store.store("p1", { authType: "m2m", privateKey: "PEM" });

    assert.notStrictEqual(await store.get("p1", "m2m"), undefined);
  });

  test("treats a half-stored TBA pair as missing", async () => {
    const backing = fakeSecretStorage();
    await backing.storage.store("suiteql.secret.p1.consumerSecret", "cs");
    const store = new SecretStore(backing.storage);

    assert.strictEqual(await store.get("p1", "tba"), undefined);
  });

  test("returns undefined when nothing was stored", async () => {
    const store = new SecretStore(fakeSecretStorage().storage);
    assert.strictEqual(await store.get("missing", "tba"), undefined);
    assert.strictEqual(await store.get("missing", "m2m"), undefined);
  });

  test("keeps different profiles' secrets apart", async () => {
    const store = new SecretStore(fakeSecretStorage().storage);
    await store.store("p1", { authType: "m2m", privateKey: "KEY-1" });
    await store.store("p2", { authType: "m2m", privateKey: "KEY-2" });

    assert.deepStrictEqual(await store.get("p2", "m2m"), { authType: "m2m", privateKey: "KEY-2" });
    await store.delete("p1");
    assert.deepStrictEqual(await store.get("p2", "m2m"), { authType: "m2m", privateKey: "KEY-2" });
  });

  test("delete clears every credential, whatever the profile's auth method", async () => {
    // Deletion must not depend on the caller knowing the auth type, or a profile whose
    // method changed leaves the other method's credential behind in SecretStorage.
    const backing = fakeSecretStorage();
    const store = new SecretStore(backing.storage);
    await store.store("p1", { authType: "tba", consumerSecret: "cs", tokenSecret: "ts" });
    await store.store("p1", { authType: "m2m", privateKey: "PEM" });
    assert.strictEqual(backing.storedKeys().length, 3);

    await store.delete("p1");

    assert.deepStrictEqual(backing.storedKeys(), []);
    assert.strictEqual(await store.get("p1", "tba"), undefined);
    assert.strictEqual(await store.get("p1", "m2m"), undefined);
  });
});
