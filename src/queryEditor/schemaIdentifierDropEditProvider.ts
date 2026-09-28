import * as vscode from "vscode";
import { SCHEMA_IDENTIFIER_MIME_TYPE } from "../objectExplorer/schemaDragAndDropController.js";

/**
 * The editor/drop half of dragging a table or column from the object explorer into a
 * SuiteQL editor — see `SchemaDragAndDropController` (the tree/drag half) for where
 * `SCHEMA_IDENTIFIER_MIME_TYPE` gets set. Requires the (default-on) `editor.dropIntoEditor.enabled`
 * setting.
 */
export class SchemaIdentifierDropEditProvider implements vscode.DocumentDropEditProvider {
  async provideDocumentDropEdits(
    _document: vscode.TextDocument,
    _position: vscode.Position,
    dataTransfer: vscode.DataTransfer,
    _token: vscode.CancellationToken,
  ): Promise<vscode.DocumentDropEdit | undefined> {
    const identifier = await dataTransfer.get(SCHEMA_IDENTIFIER_MIME_TYPE)?.asString();
    return identifier ? new vscode.DocumentDropEdit(identifier) : undefined;
  }
}

export function registerSchemaIdentifierDropEditProvider(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.languages.registerDocumentDropEditProvider({ language: "suiteql" }, new SchemaIdentifierDropEditProvider(), {
      dropMimeTypes: [SCHEMA_IDENTIFIER_MIME_TYPE],
    }),
  );
}
