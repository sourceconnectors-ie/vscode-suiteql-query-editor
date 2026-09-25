import * as assert from "assert";
import {
  DEFAULT_JWT_ALGORITHM,
  JWT_ALGORITHMS,
  getAuthType,
  isM2mInput,
  isM2mProfile,
  toConnectionProfile,
  toJwtAlgorithm,
  type ConnectionProfile,
} from "../connection/connectionProfile.js";

suite("getAuthType", () => {
  test("treats a profile saved before M2M support (no authType) as TBA", () => {
    // The back-compat case: every profile already in a user's settings.json looks like
    // this, and must keep connecting without them touching anything.
    const legacy = {
      id: "1",
      label: "Prod",
      realm: "1234567",
      consumerKey: "ck",
      tokenKey: "tk",
    } as ConnectionProfile;
    assert.strictEqual(getAuthType(legacy), "tba");
  });

  test("reads an explicit authType", () => {
    assert.strictEqual(getAuthType({ authType: "tba" }), "tba");
    assert.strictEqual(getAuthType({ authType: "m2m" }), "m2m");
  });
});

suite("isM2mProfile", () => {
  test("is false for a legacy profile with no authType", () => {
    const legacy = { id: "1", label: "P", realm: "1", consumerKey: "ck", tokenKey: "tk" } as ConnectionProfile;
    assert.strictEqual(isM2mProfile(legacy), false);
  });

  test("is true only for an M2M profile", () => {
    const m2m: ConnectionProfile = {
      id: "1",
      authType: "m2m",
      label: "P",
      realm: "1",
      clientId: "c",
      certificateId: "x",
    };
    assert.strictEqual(isM2mProfile(m2m), true);
  });
});

suite("toConnectionProfile", () => {
  test("keeps only the non-secret TBA fields", () => {
    const profile = toConnectionProfile("id-1", {
      authType: "tba",
      label: "Prod",
      realm: "1234567",
      consumerKey: "ck",
      consumerSecret: "cs",
      tokenKey: "tk",
      tokenSecret: "ts",
    });

    assert.deepStrictEqual(profile, {
      id: "id-1",
      authType: "tba",
      label: "Prod",
      realm: "1234567",
      consumerKey: "ck",
      tokenKey: "tk",
      restletUrl: undefined,
    });
    // The secrets belong in SecretStorage; settings.json must never see them.
    assert.ok(!("consumerSecret" in profile));
    assert.ok(!("tokenSecret" in profile));
  });

  test("keeps only the non-secret M2M fields, never the private key", () => {
    const profile = toConnectionProfile("id-2", {
      authType: "m2m",
      label: "Sandbox",
      realm: "1234567_SB1",
      clientId: "client",
      certificateId: "cert",
      privateKey: "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----",
      jwtAlgorithm: "ES256",
    });

    assert.deepStrictEqual(profile, {
      id: "id-2",
      authType: "m2m",
      label: "Sandbox",
      realm: "1234567_SB1",
      clientId: "client",
      certificateId: "cert",
      jwtAlgorithm: "ES256",
      restletUrl: undefined,
    });
    assert.ok(!("privateKey" in profile), "the private key must never reach settings.json");
  });
});

suite("isM2mInput", () => {
  test("routes each arm to its own shape", () => {
    assert.strictEqual(
      isM2mInput({ authType: "tba", label: "", realm: "", consumerKey: "", consumerSecret: "", tokenKey: "", tokenSecret: "" }),
      false,
    );
    assert.strictEqual(
      isM2mInput({ authType: "m2m", label: "", realm: "", clientId: "", certificateId: "", privateKey: "" }),
      true,
    );
  });
});

suite("toJwtAlgorithm", () => {
  test("accepts every algorithm the dialog offers", () => {
    for (const algorithm of JWT_ALGORITHMS) {
      assert.strictEqual(toJwtAlgorithm(algorithm), algorithm);
    }
  });

  test("rejects RS256, which NetSuite does not accept", () => {
    assert.strictEqual(toJwtAlgorithm("RS256"), undefined);
  });

  test("rejects unknown or missing values rather than passing them through", () => {
    assert.strictEqual(toJwtAlgorithm("nonsense"), undefined);
    assert.strictEqual(toJwtAlgorithm(undefined), undefined);
  });

  test("the default is one of the offered algorithms", () => {
    assert.ok(JWT_ALGORITHMS.includes(DEFAULT_JWT_ALGORITHM));
  });
});
