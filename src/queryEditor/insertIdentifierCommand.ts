import * as vscode from "vscode";

/**
 * Backs the object explorer's "Insert into Editor" context-menu entry on a table/column
 * (see `TableNode`/`ColumnNode` in `../objectExplorer/nodes.ts`, which pass themselves as
 * the argument), and can also be called programmatically with a plain identifier string.
 * Inserts that identifier at the cursor (replacing any selection) in whichever SuiteQL
 * editor last had focus — `vscode.window.activeTextEditor` stays pointed at it even while
 * the tree view itself has UI focus, the same mechanism `runQueryCommand.ts` and
 * `resultsViewProvider.ts` already rely on.
 */
export function registerInsertIdentifierCommand(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("suiteql.insertIdentifier", async (target?: string | { identifierText: string }) => {
      const identifier = typeof target === "string" ? target : target?.identifierText;
      if (!identifier) {
        return; // invoked without a table/column to insert (e.g. via a keybinding)
      }

      const editor = vscode.window.activeTextEditor;
      if (!editor || editor.document.languageId !== "suiteql") {
        void vscode.window.showInformationMessage("SuiteQL: open a SuiteQL query editor first.");
        return;
      }

      await editor.edit((editBuilder) => {
        for (const selection of editor.selections) {
          editBuilder.replace(selection, identifier);
        }
      });
    }),
  );
}
