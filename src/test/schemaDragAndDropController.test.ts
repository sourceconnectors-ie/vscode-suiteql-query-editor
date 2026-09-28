import * as assert from "assert";
import * as vscode from "vscode";
import { SCHEMA_IDENTIFIER_MIME_TYPE, SchemaDragAndDropController } from "../objectExplorer/schemaDragAndDropController.js";
import { ColumnNode, TableNode } from "../objectExplorer/nodes.js";

suite("SchemaDragAndDropController", () => {
  test("sets the identifier mime type to the table's identifier text when dragging a TableNode", () => {
    const controller = new SchemaDragAndDropController();
    const node = new TableNode("profile-1", { tableName: "Customer" });
    const dataTransfer = new vscode.DataTransfer();

    controller.handleDrag([node], dataTransfer, new vscode.CancellationTokenSource().token);

    assert.strictEqual(dataTransfer.get(SCHEMA_IDENTIFIER_MIME_TYPE)?.value, "customer");
  });

  test("sets the identifier mime type to the column's name when dragging a ColumnNode", () => {
    const controller = new SchemaDragAndDropController();
    const node = new ColumnNode({ columnName: "entityid", dataType: "STRING" });
    const dataTransfer = new vscode.DataTransfer();

    controller.handleDrag([node], dataTransfer, new vscode.CancellationTokenSource().token);

    assert.strictEqual(dataTransfer.get(SCHEMA_IDENTIFIER_MIME_TYPE)?.value, "entityid");
  });

  test("declares the identifier mime type as its only drag mime type and accepts no drops", () => {
    const controller = new SchemaDragAndDropController();
    assert.deepStrictEqual(controller.dragMimeTypes, [SCHEMA_IDENTIFIER_MIME_TYPE]);
    assert.deepStrictEqual(controller.dropMimeTypes, []);
  });
});
