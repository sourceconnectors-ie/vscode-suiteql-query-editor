import * as vscode from "vscode";

const DEFAULT_FILE_NAME = "query.suiteql";

export function registerNewQueryCommand(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("suiteql.newQuery", async (folderUri?: vscode.Uri) => {
      // Invoked from the Explorer's right-click menu on a folder: create a real file
      // there. Invoked from the Command Palette (no argument): open an untitled buffer,
      // matching VS Code's own "New Text File" behavior — there is no documented way
      // for an extension to add an entry to the native "File: New File..." picker
      // itself, so this context-menu command is the supported equivalent.
      if (folderUri) {
        const fileName = await vscode.window.showInputBox({
          prompt: "New SuiteQL file name",
          value: DEFAULT_FILE_NAME,
          validateInput: (value) => (value.trim().length === 0 ? "File name is required." : undefined),
        });
        if (!fileName) {
          return;
        }

        const finalName = fileName.endsWith(".suiteql") ? fileName : `${fileName}.suiteql`;
        const fileUri = vscode.Uri.joinPath(folderUri, finalName);
        await vscode.workspace.fs.writeFile(fileUri, new Uint8Array());
        const document = await vscode.workspace.openTextDocument(fileUri);
        await vscode.window.showTextDocument(document);
        return;
      }

      const document = await vscode.workspace.openTextDocument({ language: "suiteql", content: "" });
      await vscode.window.showTextDocument(document);
    }),
  );
}
