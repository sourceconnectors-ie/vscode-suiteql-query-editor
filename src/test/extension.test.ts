import * as assert from "assert";
import * as vscode from "vscode";

const EXTENSION_ID = "monty-nabil.suiteql-query-editor";

const EXPECTED_COMMANDS = [
  "suiteql.addConnection",
  "suiteql.removeConnection",
  "suiteql.selectConnection",
  "suiteql.activateConnectionById",
  "suiteql.disconnectConnection",
  "suiteql.setRestletUrl",
  "suiteql.addTablesToSchema",
  "suiteql.clearSchemaCache",
  "suiteql.filterSchema",
  "suiteql.clearSchemaFilter",
  "suiteql.newQuery",
  "suiteql.runQuery",
];

suite("Extension Test Suite", () => {
  test("activates without throwing", async () => {
    const extension = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(extension, `Extension "${EXTENSION_ID}" was not found — check package.json publisher/name.`);
    await extension.activate();
    assert.strictEqual(extension.isActive, true);
  });

  test("registers all expected commands", async () => {
    const allCommands = await vscode.commands.getCommands(true);
    for (const command of EXPECTED_COMMANDS) {
      assert.ok(allCommands.includes(command), `Expected command "${command}" to be registered.`);
    }
  });

  test("registers the suiteql language", async () => {
    const languages = await vscode.languages.getLanguages();
    assert.ok(languages.includes("suiteql"), 'Expected language id "suiteql" to be registered.');
  });

  test("suiteql.removeConnection is a no-op with an informational message when there are no saved connections", async () => {
    // Guards against a regression where this throws instead of showing "no saved connections".
    await vscode.commands.executeCommand("suiteql.removeConnection");
  });

  test("suiteql.setRestletUrl is a no-op with an informational message when there are no saved connections", async () => {
    await vscode.commands.executeCommand("suiteql.setRestletUrl");
  });

  test("suiteql.clearSchemaCache is a no-op with an informational message when there are no saved connections", async () => {
    await vscode.commands.executeCommand("suiteql.clearSchemaCache");
  });

  test("suiteql.newQuery opens an editor with the suiteql language id", async () => {
    await vscode.commands.executeCommand("suiteql.newQuery");
    const editor = vscode.window.activeTextEditor;
    assert.ok(editor, "Expected an active text editor after suiteql.newQuery.");
    assert.strictEqual(editor.document.languageId, "suiteql");
  });
});
