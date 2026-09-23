import { promises as fs } from "node:fs";
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
        let created: boolean;
        try {
          created = await createEmptyFileExclusive(fileUri);
        } catch (error) {
          void vscode.window.showErrorMessage(
            `SuiteQL: could not create "${finalName}" — ${error instanceof Error ? error.message : String(error)}`,
          );
          return;
        }
        if (!created) {
          // Never overwrite an existing file with an empty one — offer to open it instead.
          const choice = await vscode.window.showWarningMessage(`"${finalName}" already exists in this folder.`, "Open Existing");
          if (choice === "Open Existing") {
            await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(fileUri));
          }
          return;
        }
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

/**
 * Creates an empty file at `uri` only if nothing is there yet, in one step — a separate
 * "does it exist?" check followed by a write would let a file created in between get
 * overwritten. Returns `false` (touching nothing) if the file already exists; throws if
 * the file couldn't be created for any other reason.
 *
 * A `file:` URI uses an exclusive open (`wx`), which the OS makes atomic. Any other scheme
 * (a virtual/remote file system) goes through `WorkspaceEdit.createFile` with
 * `overwrite: false`, the most exclusive create the VS Code API offers there.
 */
export async function createEmptyFileExclusive(uri: vscode.Uri): Promise<boolean> {
  if (uri.scheme === "file") {
    try {
      await fs.writeFile(uri.fsPath, "", { flag: "wx" });
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") {
        return false;
      }
      throw error;
    }
  }
  const edit = new vscode.WorkspaceEdit();
  edit.createFile(uri, { overwrite: false, ignoreIfExists: false });
  if (await vscode.workspace.applyEdit(edit)) {
    return true;
  }
  // `applyEdit` only reports false, not why. Report "already exists" only when that's
  // actually the reason; anything else (permissions, a read-only file system) is an error.
  try {
    await vscode.workspace.fs.stat(uri);
    return false;
  } catch {
    throw new Error(`Could not create ${uri.toString(true)}.`);
  }
}
