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
          validateInput: validateFileName,
        });
        if (!fileName) {
          return;
        }

        const trimmed = fileName.trim();
        const finalName = trimmed.endsWith(".suiteql") ? trimmed : `${trimmed}.suiteql`;
        const fileUri = vscode.Uri.joinPath(folderUri, finalName);
        if (await exists(fileUri)) {
          // Never overwrite an existing file with an empty one — offer to open it instead.
          const choice = await vscode.window.showWarningMessage(`"${finalName}" already exists in this folder.`, "Open Existing");
          if (choice === "Open Existing") {
            await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(fileUri));
          }
          return;
        }
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

function validateFileName(value: string): string | undefined {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return "File name is required.";
  }
  if (/[\\/]/.test(trimmed) || trimmed === "." || trimmed === "..") {
    return "Enter a file name, not a path.";
  }
  return undefined;
}

async function exists(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}
