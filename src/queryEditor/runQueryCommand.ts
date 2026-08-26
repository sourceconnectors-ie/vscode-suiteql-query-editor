import * as vscode from "vscode";
import type { ActiveConnectionManager } from "../connection/activeConnection.js";
import type { ResultsViewProvider } from "../resultsPane/resultsViewProvider.js";

export function registerRunQueryCommand(
  context: vscode.ExtensionContext,
  activeConnection: ActiveConnectionManager,
  resultsView: ResultsViewProvider,
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("suiteql.runQuery", async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        void vscode.window.showErrorMessage("SuiteQL: no active editor.");
        return;
      }

      if (!activeConnection.get()) {
        void vscode.window.showErrorMessage("SuiteQL: no active connection. Add or select a connection first.");
        return;
      }

      const selection = editor.selection;
      const text = selection.isEmpty ? editor.document.getText() : editor.document.getText(selection);
      const queryText = text.trim();
      if (!queryText) {
        void vscode.window.showInformationMessage("SuiteQL: nothing to run.");
        return;
      }

      await resultsView.runQuery(queryText, editor.document.uri);
    }),
  );
}
