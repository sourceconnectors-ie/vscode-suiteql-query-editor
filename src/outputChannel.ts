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

const MAX_LOGGED_RAW_BODY_LENGTH = 2000;

export function logError(message: string, error?: unknown): void {
  const suffix = error instanceof Error ? ` ${error.message}` : error ? ` ${String(error)}` : "";
  getOutputChannel().appendLine(`[error] ${message}${suffix}${rawBodySuffix(error)}`);
}

/**
 * `SuiteQLHttpError`/`RestletClient` responses carry the server's raw body, which can hold
 * detail the extracted error message doesn't (e.g. NetSuite returning an HTML permission
 * page for a 403, where the message falls back to a generic "HTTP 403: Forbidden"). Duck-typed
 * rather than an `instanceof` check against the vendored error class, to keep this module
 * free of a vendor dependency.
 */
function rawBodySuffix(error: unknown): string {
  const rawBody = error && typeof error === "object" && "rawBody" in error ? (error as { rawBody?: unknown }).rawBody : undefined;
  if (typeof rawBody !== "string" || !rawBody) {
    return "";
  }
  const shortened = rawBody.length > MAX_LOGGED_RAW_BODY_LENGTH ? `${rawBody.slice(0, MAX_LOGGED_RAW_BODY_LENGTH)}…` : rawBody;
  return `\n  raw response body: ${shortened}`;
}
