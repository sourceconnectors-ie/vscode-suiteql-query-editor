import * as assert from "assert";
import * as os from "node:os";
import * as vscode from "vscode";
import { COMPANY_NAME, COMPANY_URL } from "@monty-nabil/netsuite-api-client-ts";
import { ActiveConnectionManager } from "../connection/activeConnection.js";
import { ConnectionProfileStore } from "../connection/connectionProfileStore.js";
import { ObjectExplorerProvider } from "../objectExplorer/objectExplorerProvider.js";
import { ActiveSchemaCache } from "../schemaCache/activeSchemaCache.js";
import { SchemaCacheStore } from "../schemaCache/schemaCacheStore.js";

function makeProvider(): ObjectExplorerProvider {
  const activeConnection = new ActiveConnectionManager();
  const schemaCache = new ActiveSchemaCache(activeConnection, new SchemaCacheStore(vscode.Uri.file(os.tmpdir())));
  return new ObjectExplorerProvider(activeConnection, schemaCache, new ConnectionProfileStore());
}

suite("ObjectExplorerProvider attribution", () => {
  test("the last root node always credits the library, whatever else is showing", () => {
    // Deliberately doesn't assume the test environment has zero saved connections —
    // asserts the invariant that holds either way: attribution is always last, and always
    // present, rather than only appearing in the empty state.
    const provider = makeProvider();
    const roots = provider.getChildren();

    assert.ok(roots.length > 0);
    const last = roots[roots.length - 1];
    assert.strictEqual(last.contextValue, "suiteql.attribution");
    assert.strictEqual(String(last.label), `Powered by ${COMPANY_NAME}`);
    assert.strictEqual(last.description, COMPANY_URL);

    // Every other root node is unaffected — the credit is appended, not substituted.
    const attributionCount = roots.filter((node) => node.contextValue === "suiteql.attribution").length;
    assert.strictEqual(attributionCount, 1);
  });

  test("clicking it runs the command that opens the site", () => {
    const provider = makeProvider();
    const roots = provider.getChildren();
    const attribution = roots[roots.length - 1];

    assert.deepStrictEqual(attribution.command?.command, "suiteql.openAttributionSite");
  });
});
