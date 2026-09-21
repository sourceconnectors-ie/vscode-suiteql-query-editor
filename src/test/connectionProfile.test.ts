import * as assert from "assert";
import { validateRestletUrl } from "../connection/connectionProfile.js";

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
