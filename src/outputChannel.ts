import * as vscode from "vscode";

let channel: vscode.OutputChannel | undefined;

export function getOutputChannel(): vscode.OutputChannel {
  channel ??= vscode.window.createOutputChannel("SuiteQL");
  return channel;
}

export function logInfo(message: string): void {
  getOutputChannel().appendLine(`[info] ${message}`);
}

export function logWarning(message: string, details?: Record<string, unknown>): void {
  const suffix = details ? ` ${JSON.stringify(details)}` : "";
  getOutputChannel().appendLine(`[warn] ${message}${suffix}`);
}

export function logError(message: string, error?: unknown): void {
  const suffix = error instanceof Error ? ` ${error.message}` : error ? ` ${String(error)}` : "";
  getOutputChannel().appendLine(`[error] ${message}${suffix}`);
}
