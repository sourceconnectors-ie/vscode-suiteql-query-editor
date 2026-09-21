import * as assert from "assert";
import { OperationCancelledError } from "../../vendor/netsuite-api-client-ts/errors.js";
import { sleep } from "../../vendor/netsuite-api-client-ts/retry.js";

suite("sleep", () => {
  test("resolves normally with no signal", async () => {
    await sleep(0.01);
  });

  test("rejects immediately if the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(() => sleep(30, controller.signal), OperationCancelledError);
  });

  test("rejects as soon as the signal aborts mid-wait, without waiting out the full delay", async () => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 10);
    const startedAt = Date.now();
    await assert.rejects(() => sleep(30, controller.signal), OperationCancelledError);
    assert.ok(Date.now() - startedAt < 1000, "expected the wait to be cut short by cancellation, not the full 30s delay");
  });
});
