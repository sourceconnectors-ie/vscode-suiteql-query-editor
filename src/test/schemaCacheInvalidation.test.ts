import * as assert from "assert";
import { isCacheStaleForEndpoint } from "../schemaCache/schemaDownloadService.js";

suite("isCacheStaleForEndpoint", () => {
  test("a cache with no recorded restletUrl (pre-existing on disk) is never stale", () => {
    assert.strictEqual(isCacheStaleForEndpoint({ restletUrl: undefined }, "https://a.example.com/restlet"), false);
  });

  test("the same restletUrl is not stale", () => {
    const url = "https://a.example.com/restlet";
    assert.strictEqual(isCacheStaleForEndpoint({ restletUrl: url }, url), false);
  });

  test("a different restletUrl is stale", () => {
    assert.strictEqual(
      isCacheStaleForEndpoint({ restletUrl: "https://a.example.com/restlet" }, "https://b.example.com/restlet"),
      true,
    );
  });
});
