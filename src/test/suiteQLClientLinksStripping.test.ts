import * as assert from "assert";
import { parseSuiteQLConfig, SuiteQLClient } from "../../vendor/netsuite-api-client-ts/index.js";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

suite("SuiteQLClient links stripping", () => {
  const originalFetch = globalThis.fetch;

  teardown(() => {
    globalThis.fetch = originalFetch;
  });

  test("strips the REST endpoint's HATEOAS 'links' field from every row", async () => {
    globalThis.fetch = (async () =>
      jsonResponse(200, {
        items: [
          { links: [{ rel: "self", href: "https://example.com/1" }], id: "1", entityid: "Acme" },
          { links: [{ rel: "self", href: "https://example.com/2" }], id: "2", entityid: "Globex" },
        ],
        hasMore: false,
        count: 2,
        offset: 0,
        totalResults: 2,
      })) as typeof fetch;

    const config = parseSuiteQLConfig({
      realm: "1234567_SB1",
      consumerKey: "ck",
      consumerSecret: "cs",
      tokenKey: "tk",
      tokenSecret: "ts",
    });
    const client = new SuiteQLClient(config);
    const result = await client.executeQuery("SELECT id, entityid FROM customer", 100, 0);

    assert.deepStrictEqual(result.items, [
      { id: "1", entityid: "Acme" },
      { id: "2", entityid: "Globex" },
    ]);
    for (const item of result.items) {
      assert.ok(!("links" in item));
    }
  });

  test("leaves a row untouched when it has no links field", async () => {
    globalThis.fetch = (async () =>
      jsonResponse(200, { items: [{ id: "1" }], hasMore: false, count: 1, offset: 0, totalResults: 1 })) as typeof fetch;

    const config = parseSuiteQLConfig({
      realm: "1234567_SB1",
      consumerKey: "ck",
      consumerSecret: "cs",
      tokenKey: "tk",
      tokenSecret: "ts",
    });
    const client = new SuiteQLClient(config);
    const result = await client.executeQuery("SELECT id FROM customer", 100, 0);

    assert.deepStrictEqual(result.items, [{ id: "1" }]);
  });
});
