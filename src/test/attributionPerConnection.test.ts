import * as assert from "assert";
import {
  parseSuiteQLConfig,
  resetAttributionEmission,
  setAttributionSink,
} from "@monty-nabil/netsuite-api-client-ts";
import { ActiveConnectionManager } from "../connection/activeConnection.js";
import type { ConnectionProfile } from "../connection/connectionProfile.js";

function tbaProfile(id: string, label: string): ConnectionProfile {
  return { id, authType: "tba", label, realm: "1234567_SB1", consumerKey: "ck", tokenKey: "tk" };
}

const config = parseSuiteQLConfig({
  realm: "1234567_SB1",
  consumerKey: "ck",
  consumerSecret: "cs",
  tokenKey: "tk",
  tokenSecret: "ts",
});

suite("attribution banner per connection", () => {
  let banners: string[];

  setup(() => {
    banners = [];
    setAttributionSink((text) => banners.push(text));
    resetAttributionEmission();
  });

  test("shows once per connection, and again after reconnecting", () => {
    // What a user sees across a connect / disconnect / reconnect cycle. "Once per
    // process" would have shown it at the first connection and never again, however long
    // the window stayed open.
    const active = new ActiveConnectionManager();

    active.connect(tbaProfile("p1", "Prod"), config);
    assert.strictEqual(banners.length, 1, "expected a banner on the first connection");

    active.disconnect();
    assert.strictEqual(banners.length, 1, "disconnecting shouldn't emit a banner");

    active.connect(tbaProfile("p1", "Prod"), config);
    assert.strictEqual(banners.length, 2, "expected a fresh banner on reconnecting");

    active.dispose();
  });

  test("shows once when switching connections, not twice", () => {
    // connect() disconnects the previous connection first; that internal transition must
    // not count as a session of its own.
    const active = new ActiveConnectionManager();

    active.connect(tbaProfile("p1", "Prod"), config);
    active.connect(tbaProfile("p2", "Sandbox"), config);

    assert.strictEqual(banners.length, 2, "expected exactly one banner per connection");
    active.dispose();
  });

  test("doesn't emit again for the RESTlet client built later in the same connection", () => {
    // Schema discovery builds a second client under a different OAuth2 scope. That's the
    // same session, so it must not produce a second banner.
    const active = new ActiveConnectionManager();
    const connection = active.connect(tbaProfile("p1", "Prod"), config);
    assert.strictEqual(banners.length, 1);

    connection.getRestletClient();
    connection.getRestletClient();

    assert.strictEqual(banners.length, 1, "a second client in one connection shouldn't re-emit");
    active.dispose();
  });

  test("carries the attribution text, not an empty line", () => {
    const active = new ActiveConnectionManager();
    active.connect(tbaProfile("p1", "Prod"), config);

    assert.ok(banners[0] && banners[0].trim().length > 0);
    assert.match(banners[0], /https?:\/\//, "expected the banner to carry the attribution URL");
    active.dispose();
  });
});
