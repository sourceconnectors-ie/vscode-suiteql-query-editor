import * as assert from "assert";
import {
  OperationCancelledError,
  parseSuiteQLConfig,
  SuiteQLClient,
} from "../../vendor/netsuite-api-client-ts/index.js";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

suite("SuiteQLClient cancellation", () => {
  const originalFetch = globalThis.fetch;

  teardown(() => {
    globalThis.fetch = originalFetch;
  });

  test("cancelling while a retryable failure is outstanding stops further requests", async () => {
    let calls = 0;
    const controller = new AbortController();
    globalThis.fetch = (async () => {
      calls += 1;
      controller.abort();
      return jsonResponse(503, { error: "unavailable" });
    }) as typeof fetch;

    const config = parseSuiteQLConfig({
      realm: "1234567_SB1",
      consumerKey: "ck",
      consumerSecret: "cs",
      tokenKey: "tk",
      tokenSecret: "ts",
      maxRetries: 3,
      initialRetryDelay: 30,
    });
    const client = new SuiteQLClient(config);

    await assert.rejects(
      () => client.executeQuery("SELECT id FROM customer", 100, 0, controller.signal),
      OperationCancelledError,
    );
    assert.strictEqual(calls, 1, "expected no retry attempts after cancellation — a stale query must stop, not run out its retry budget");
  });
});
