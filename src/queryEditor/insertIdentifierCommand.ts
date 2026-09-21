import * as vscode from "vscode";

/**
 * Backs clicking a table/column in the object explorer (see `TableNode`/`ColumnNode` in
 * `../objectExplorer/nodes.ts`): inserts that identifier at the cursor (replacing any
 * selection) in whichever SuiteQL editor last had focus — `vscode.window.activeTextEditor`
 * stays pointed at it even while the tree view itself has UI focus, the same mechanism
 * `runQueryCommand.ts` and `resultsViewProvider.ts` already rely on.
 */
export function registerInsertIdentifierCommand(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("suiteql.insertIdentifier", async (identifier: string) => {
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
