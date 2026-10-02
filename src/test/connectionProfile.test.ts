import * as assert from "assert";
import { validateBaseUrlOverride, validateRestletUrl } from "../connection/connectionProfile.js";

suite("validateRestletUrl", () => {
  test("undefined is valid (optional field, not set)", () => {
    assert.strictEqual(validateRestletUrl(undefined), undefined);
  });

  test("empty/whitespace-only is valid (clears the field)", () => {
    assert.strictEqual(validateRestletUrl(""), undefined);
    assert.strictEqual(validateRestletUrl("   "), undefined);
  });

  test("a valid https:// URL is valid", () => {
    assert.strictEqual(
      validateRestletUrl("https://acct.restlets.api.netsuite.com/app/site/hosting/restlet.nl?script=1&deploy=1"),
      undefined,
    );
  });

  test("an http:// URL is rejected", () => {
    assert.ok(validateRestletUrl("http://acct.restlets.api.netsuite.com/restlet.nl"));
  });

  test("malformed text is rejected", () => {
    assert.ok(validateRestletUrl("not a url"));
  });
});

suite("validateBaseUrlOverride", () => {
  test("unset or blank is valid (optional field)", () => {
    assert.strictEqual(validateBaseUrlOverride(undefined), undefined);
    assert.strictEqual(validateBaseUrlOverride("   "), undefined);
  });

  test("http and https URLs, with a port or path prefix, are valid", () => {
    assert.strictEqual(validateBaseUrlOverride("http://127.0.0.1:8000"), undefined);
    assert.strictEqual(validateBaseUrlOverride("https://mock.example.com/proxy"), undefined);
  });

  test("a non-http scheme is rejected", () => {
    assert.ok(validateBaseUrlOverride("ftp://host"));
  });

  test("malformed text is rejected", () => {
    assert.ok(validateBaseUrlOverride("not a url"));
  });

  test("a query string, fragment or embedded credentials are rejected", () => {
    assert.ok(validateBaseUrlOverride("http://host:8000?x=1"));
    assert.ok(validateBaseUrlOverride("http://host:8000/#frag"));
    assert.ok(validateBaseUrlOverride("http://user:pw@host:8000"));
  });
});
