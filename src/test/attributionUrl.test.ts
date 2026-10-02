import * as assert from "assert";
import { COMPANY_URL } from "@monty-nabil/netsuite-api-client-ts";
import { attributionUrl } from "../attribution.js";

suite("attributionUrl", () => {
  test("tags the company URL so extension-driven visits are identifiable in web analytics", () => {
    const url = new URL(attributionUrl());
    assert.strictEqual(url.origin, COMPANY_URL);
    assert.strictEqual(url.searchParams.get("utm_source"), "suiteql-query-editor");
    assert.strictEqual(url.searchParams.get("utm_medium"), "vscode-extension");
    assert.strictEqual(url.searchParams.get("utm_campaign"), "attribution");
  });
});
