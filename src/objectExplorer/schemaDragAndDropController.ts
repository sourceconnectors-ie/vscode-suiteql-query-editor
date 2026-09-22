import * as vscode from "vscode";
import { ColumnNode, TableNode, type ObjectExplorerNode } from "./nodes.js";

/**
 * Carries a dragged table/column's insertable identifier text from
 * `SchemaDragAndDropController.handleDrag` (the tree/drag side) to
 * `SchemaIdentifierDropEditProvider` (the editor/drop side — see
 * `../queryEditor/schemaIdentifierDropEditProvider.ts`). Not `text/plain`: per
 * `vscode.DocumentDropEditProvider`'s own docs, drops into the editor are meant to be
 * handled by a registered provider matching a specific mime type, not by relying on
 * unspecified default handling of a generic one.
 */
export const SCHEMA_IDENTIFIER_MIME_TYPE = "application/vnd.code.suiteql.identifier";

/**
 * Lets a table or column be dragged out of the object explorer and dropped into a text
 * editor — see `SchemaIdentifierDropEditProvider` for the other half. This extension
 * doesn't accept drops back into the tree, so `dropMimeTypes` is empty and `handleDrop` is
 * never called — `TreeDragAndDropController` requires both properties regardless.
 */
export class SchemaDragAndDropController implements vscode.TreeDragAndDropController<ObjectExplorerNode> {
  readonly dropMimeTypes: readonly string[] = [];
  readonly dragMimeTypes: readonly string[] = [SCHEMA_IDENTIFIER_MIME_TYPE];

  handleDrag(source: readonly ObjectExplorerNode[], dataTransfer: vscode.DataTransfer, _token: vscode.CancellationToken): void {
    const node = source[0];
    if (node instanceof TableNode || node instanceof ColumnNode) {
      dataTransfer.set(SCHEMA_IDENTIFIER_MIME_TYPE, new vscode.DataTransferItem(node.identifierText));
    }
  }
}
