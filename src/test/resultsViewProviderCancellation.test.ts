import * as assert from "assert";
import * as os from "node:os";
import * as vscode from "vscode";
import { parseSuiteQLConfig, SuiteQLConnector } from "../../vendor/netsuite-api-client-ts/index.js";
import { ActiveConnectionManager } from "../connection/activeConnection.js";
import type { ConnectionProfile } from "../connection/connectionProfile.js";
import { ResultsViewProvider } from "../resultsPane/resultsViewProvider.js";
import { ActiveSchemaCache } from "../schemaCache/activeSchemaCache.js";
import { SchemaCacheStore } from "../schemaCache/schemaCacheStore.js";

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

function raceWithTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(message)), ms)),
  ]);
}

function makeProvider(): ResultsViewProvider {
  const activeConnection = new ActiveConnectionManager();
  const profile: ConnectionProfile = {
    id: "test-profile",
    label: "Test Connection",
    realm: "1234567_SB1",
    consumerKey: "ck",
    tokenKey: "tk",
  };
  const config = parseSuiteQLConfig({
    realm: profile.realm,
    consumerKey: profile.consumerKey,
    consumerSecret: "cs",
    tokenKey: profile.tokenKey,
    tokenSecret: "ts",
    maxRetries: 0,
    initialRetryDelay: 0.1,
  });
  activeConnection.connect(profile, new SuiteQLConnector(config), config);

  const schemaCache = new ActiveSchemaCache(activeConnection, new SchemaCacheStore(vscode.Uri.file(os.tmpdir())));
  return new ResultsViewProvider(vscode.Uri.file(os.tmpdir()), activeConnection, schemaCache);
}

/**
 * Regression coverage for two bugs reported against `resultsViewProvider.ts`:
 *
 * - Overlapping query runs for the same document mixed results (the formal Bug Review's
 *   Finding 1): starting a new run while a previous one for the same document was still
 *   in flight never cancelled it, so both could go on posting pages/state concurrently.
 * - Cancelling from the "Stop" progress notification, or disconnecting, only flagged the
 *   execution instead of actually aborting its in-flight HTTP request (the PR review
 *   comment on this file): a request already sent kept running to completion (or its own
 *   retry budget) instead of stopping immediately.
 *
 * Both are exercised through the provider's public surface only (`runQuery`,
 * `isAnyExecutionRunning`, `requestCancelCurrentExecution`, `waitForCurrentExecution`) —
 * no reach into private state — using a mocked `fetch` that only ever settles once its
 * request's `AbortSignal` actually fires, the same pattern `suiteQLClientCancellation.test.ts`
 * uses to prove an abort actually reaches the in-flight request rather than merely being
 * requested.
 */
suite("ResultsViewProvider cancellation", () => {
  const originalFetch = globalThis.fetch;

  teardown(() => {
    globalThis.fetch = originalFetch;
  });

  test("starting a new run for the same document cancels the still-running previous one instead of letting both run concurrently", async () => {
    const provider = makeProvider();
    const uri = vscode.Uri.parse("untitled:cancel-test-1.suiteql");
    let abortedRequestCount = 0;

    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      const signal = init?.signal as AbortSignal;
      return await new Promise<Response>((resolve, reject) => {
        if (signal.aborted) {
          abortedRequestCount += 1;
          reject(new DOMException("Aborted", "AbortError"));
          return;
        }
        const timer = setTimeout(
          () => resolve(jsonResponse({ items: [{ id: "1" }], hasMore: false, count: 1, offset: 0, totalResults: 1 })),
          50,
        );
        signal.addEventListener("abort", () => {
          clearTimeout(timer);
          abortedRequestCount += 1;
          reject(new DOMException("Aborted", "AbortError"));
        });
      });
    }) as typeof fetch;

    const firstRun = provider.runQuery("SELECT id FROM customer", uri);
    await new Promise((resolve) => setTimeout(resolve, 5)); // let the first run's request actually start
    assert.strictEqual(provider.isAnyExecutionRunning(), true);

    await provider.runQuery("SELECT id FROM customer", uri); // supersedes the first run for the same document
    await firstRun; // runQuery never rejects — a cancelled run resolves normally

    await raceWithTimeout(
      provider.waitForCurrentExecution(),
      2000,
      "the superseded run's in-flight request was never aborted — waitForCurrentExecution hung",
    );

    assert.strictEqual(provider.isAnyExecutionRunning(), false);
    assert.ok(
      abortedRequestCount >= 1,
      "expected the superseded run's request to actually be aborted, not just flagged as cancelled",
    );
  });

  test("requestCancelCurrentExecution actually aborts the in-flight request, not just flags it", async () => {
    const provider = makeProvider();
    const uri = vscode.Uri.parse("untitled:cancel-test-2.suiteql");
    let aborted = false;

    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      const signal = init?.signal as AbortSignal;
      // Deliberately never resolves on its own — only settles once aborted. Before this
      // fix, requestCancelCurrentExecution() only set a flag that's checked between pages,
      // never abort()ed the controller, so a request already sent (like this one) would be
      // left running — and waitForCurrentExecution() would hang waiting for it.
      return await new Promise<Response>((_resolve, reject) => {
        signal.addEventListener("abort", () => {
          aborted = true;
          reject(new DOMException("Aborted", "AbortError"));
        });
      });
    }) as typeof fetch;

    const run = provider.runQuery("SELECT id FROM customer", uri);
    await new Promise((resolve) => setTimeout(resolve, 5)); // let the request actually start
    assert.strictEqual(provider.isAnyExecutionRunning(), true);

    provider.requestCancelCurrentExecution();

    await raceWithTimeout(
      provider.waitForCurrentExecution(),
      2000,
      "requestCancelCurrentExecution did not actually abort the in-flight request — waitForCurrentExecution hung",
    );
    await run;

    assert.strictEqual(aborted, true);
    assert.strictEqual(provider.isAnyExecutionRunning(), false);
  });
});
