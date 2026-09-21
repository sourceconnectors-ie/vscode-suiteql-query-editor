import * as vscode from "vscode";
import { DoubleClickDetector } from "./doubleClickDetector.js";
import { ColumnNode, TableNode, type ObjectExplorerNode } from "./nodes.js";

const DOUBLE_CLICK_THRESHOLD_MS = 500;

/**
 * `vscode.TreeItem` has no native double-click hook — `TreeItem.command` fires on a
 * single click, which is too eager for something as consequential as inserting text into
 * an editor (it'd fire on every expand/collapse and keyboard-navigation click too). A
 * `TreeView`'s selection-change event fires on every click, including re-clicking an
 * already-selected row, so `DoubleClickDetector` is used to tell an actual double click
 * apart from two unrelated single clicks.
 */
export function registerDoubleClickToInsert(
  context: vscode.ExtensionContext,
  treeView: vscode.TreeView<ObjectExplorerNode>,
): void {
  const detector = new DoubleClickDetector<ObjectExplorerNode>(DOUBLE_CLICK_THRESHOLD_MS);

  context.subscriptions.push(
    treeView.onDidChangeSelection((event) => {
      const node = event.selection[0];
      if (node === undefined || !detector.registerClick(node)) {
        return;
      }
      if (node instanceof TableNode || node instanceof ColumnNode) {
        void vscode.commands.executeCommand("suiteql.insertIdentifier", node.identifierText);
      }
    }),
  );
}
