import * as assert from "assert";
import {
  OperationCancelledError,
  parseSuiteQLConfig,
  RestletClient,
  UnauthorizedError,
  type SuiteQLConfigInput,
} from "../../vendor/netsuite-api-client-ts/index.js";

function makeConfig(overrides: Partial<SuiteQLConfigInput> = {}) {
  return parseSuiteQLConfig({
    realm: "1234567_SB1",
    consumerKey: "ck",
    consumerSecret: "cs",
    tokenKey: "tk",
    tokenSecret: "ts",
    initialRetryDelay: 0.1,
    ...overrides,
  });
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

suite("RestletClient", () => {
  const originalFetch = globalThis.fetch;

  teardown(() => {
    globalThis.fetch = originalFetch;
  });

  test("a retryable status is retried exactly maxRetries+1 total attempts, then throws", async function () {
    this.timeout(8000); // real backoff waits (with jitter) happen here — see retry.ts's calculateBackoff

    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      return jsonResponse(503, { error: "unavailable" });
    }) as typeof fetch;

    const client = new RestletClient(makeConfig({ maxRetries: 3 }));
    await assert.rejects(() => client.call("https://example.restlets.api.netsuite.com/restlet"));
    assert.strictEqual(calls, 4, "expected exactly maxRetries+1 attempts — no nested retry multiplication");
  });

  test("a non-retryable status (401) gets exactly one attempt", async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      return jsonResponse(401, { error: "unauthorized" });
    }) as typeof fetch;

    const client = new RestletClient(makeConfig({ maxRetries: 3 }));
    await assert.rejects(
      () => client.call("https://example.restlets.api.netsuite.com/restlet"),
      UnauthorizedError,
    );
    assert.strictEqual(calls, 1);
  });

  test("cancelling while a retryable failure is outstanding stops further attempts", async () => {
    let calls = 0;
    const controller = new AbortController();
    globalThis.fetch = (async () => {
      calls += 1;
      // Simulates the caller cancelling while this request is still in flight, and the
      // request then coming back as a retryable failure anyway.
      controller.abort();
      return jsonResponse(503, { error: "unavailable" });
    }) as typeof fetch;

    // A large initialRetryDelay would previously have meant sitting through the full
    // backoff before the outer loop noticed cancellation — the fix must not wait it out.
    const client = new RestletClient(makeConfig({ maxRetries: 3, initialRetryDelay: 30 }));
    await assert.rejects(
      () => client.call("https://example.restlets.api.netsuite.com/restlet", { signal: controller.signal }),
      OperationCancelledError,
    );
    assert.strictEqual(calls, 1, "expected no retry attempts after cancellation");
  });

  test("cancelling before the call starts throws without making any request", async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      return jsonResponse(200, { ok: true });
    }) as typeof fetch;

    const controller = new AbortController();
    controller.abort();

    const client = new RestletClient(makeConfig());
    await assert.rejects(
      () => client.call("https://example.restlets.api.netsuite.com/restlet", { signal: controller.signal }),
      OperationCancelledError,
    );
    assert.strictEqual(calls, 0);
  });
});
