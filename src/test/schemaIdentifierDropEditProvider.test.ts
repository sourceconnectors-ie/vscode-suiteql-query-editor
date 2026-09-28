import * as assert from "assert";
import * as vscode from "vscode";
import { SCHEMA_IDENTIFIER_MIME_TYPE } from "../objectExplorer/schemaDragAndDropController.js";
import { SchemaIdentifierDropEditProvider } from "../queryEditor/schemaIdentifierDropEditProvider.js";

suite("SchemaIdentifierDropEditProvider", () => {
  test("returns a DocumentDropEdit inserting the dragged identifier", async () => {
    const provider = new SchemaIdentifierDropEditProvider();
    const document = await vscode.workspace.openTextDocument({ language: "suiteql", content: "select * from " });
    const position = new vscode.Position(0, 14);
    const dataTransfer = new vscode.DataTransfer();
    dataTransfer.set(SCHEMA_IDENTIFIER_MIME_TYPE, new vscode.DataTransferItem("customer"));

    const edit = await provider.provideDocumentDropEdits(document, position, dataTransfer, new vscode.CancellationTokenSource().token);

    assert.ok(edit);
    assert.strictEqual(edit.insertText, "customer");
  });

  test("returns undefined when the data transfer carries no identifier mime type", async () => {
    const provider = new SchemaIdentifierDropEditProvider();
    const document = await vscode.workspace.openTextDocument({ language: "suiteql", content: "" });
    const dataTransfer = new vscode.DataTransfer();
    dataTransfer.set("text/plain", new vscode.DataTransferItem("not the right mime type"));

    const edit = await provider.provideDocumentDropEdits(document, new vscode.Position(0, 0), dataTransfer, new vscode.CancellationTokenSource().token);

    assert.strictEqual(edit, undefined);
  });
});
