import * as assert from "assert";
import * as vscode from "vscode";

suite("suiteql.insertIdentifier", () => {
  test("inserts the identifier at the cursor in the active SuiteQL editor", async () => {
    const document = await vscode.workspace.openTextDocument({ language: "suiteql", content: "select * from " });
    const editor = await vscode.window.showTextDocument(document);
    const endOfLine = new vscode.Position(0, document.lineAt(0).text.length);
    editor.selection = new vscode.Selection(endOfLine, endOfLine);

    await vscode.commands.executeCommand("suiteql.insertIdentifier", "customer");

    assert.strictEqual(document.getText(), "select * from customer");
  });

  test("replaces the current selection instead of just inserting at its start", async () => {
    const document = await vscode.workspace.openTextDocument({ language: "suiteql", content: "select * from old_table" });
    const editor = await vscode.window.showTextDocument(document);
    const start = new vscode.Position(0, "select * from ".length);
    const end = new vscode.Position(0, "select * from old_table".length);
    editor.selection = new vscode.Selection(start, end);

    await vscode.commands.executeCommand("suiteql.insertIdentifier", "customer");

    assert.strictEqual(document.getText(), "select * from customer");
  });

  test("does nothing (shows a message) when the active editor isn't a SuiteQL document", async () => {
    const document = await vscode.workspace.openTextDocument({ language: "plaintext", content: "not suiteql" });
    await vscode.window.showTextDocument(document);

    await vscode.commands.executeCommand("suiteql.insertIdentifier", "customer");

    assert.strictEqual(document.getText(), "not suiteql");
  });
});
