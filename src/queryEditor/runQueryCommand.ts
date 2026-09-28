import * as vscode from "vscode";
import type { ActiveConnectionManager } from "../connection/activeConnection.js";
import type { ResultsViewProvider } from "../resultsPane/resultsViewProvider.js";
import { singleStatement, statementAtOffset } from "./statementAtCursor.js";

export function registerRunQueryCommand(
  context: vscode.ExtensionContext,
  activeConnection: ActiveConnectionManager,
  resultsView: ResultsViewProvider,
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("suiteql.runQuery", async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || editor.document.languageId !== "suiteql") {
        void vscode.window.showErrorMessage("SuiteQL: open a SuiteQL query editor first.");
        return;
      }

      if (!activeConnection.get()) {
        void vscode.window.showErrorMessage("SuiteQL: no active connection. Add or select a connection first.");
        return;
      }

      // With a selection, run exactly that; otherwise run the statement under the cursor,
      // so a file holding several `;`-separated queries doesn't get sent to NetSuite whole.
      const selection = editor.selection;
      let queryText: string | undefined;
      try {
        queryText = selection.isEmpty
          ? statementAtOffset(editor.document.getText(), editor.document.offsetAt(selection.active))
          : singleStatement(editor.document.getText(selection));
      } catch (error) {
        void vscode.window.showErrorMessage(`SuiteQL: ${error instanceof Error ? error.message : String(error)}`);
        return;
      }
      if (!queryText) {
        void vscode.window.showInformationMessage("SuiteQL: nothing to run.");
        return;
      }

      await resultsView.runQuery(queryText, editor.document.uri);
    }),
  );
}
