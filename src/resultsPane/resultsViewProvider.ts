import { randomBytes } from "node:crypto";
import * as vscode from "vscode";
import { SuiteQLClient } from "../../vendor/netsuite-api-client-ts/index.js";
import type { ActiveConnectionManager } from "../connection/activeConnection.js";
import { presentError } from "../errors/errorPresenter.js";
import { logError, logInfo } from "../outputChannel.js";
import { toCsv } from "./exporters/csvExporter.js";
import { toJson } from "./exporters/jsonExporter.js";
import {
  DEFAULT_ROW_CAP,
  type ResultsInboundMessage,
  type ResultsOutboundMessage,
  type SerializedQueryMessage,
  type SerializedQueryState,
} from "./resultsProtocol.js";

interface QueryExecutionState {
  queryText: string;
  fetchAll: boolean;
  status: "running" | "done" | "error";
  columns: string[];
  rows: Array<Record<string, unknown>>;
  totalRows: number;
  hitRowCap: boolean;
  errorMessage?: string;
  messages: SerializedQueryMessage[];
  cancelRequested: boolean;
  currentExecution?: Thenable<void>;
}

const MAX_LOGGED_QUERY_LENGTH = 300;

/** Collapses whitespace/newlines for a compact single-line log entry. */
function oneLine(text: string): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  return collapsed.length > MAX_LOGGED_QUERY_LENGTH ? `${collapsed.slice(0, MAX_LOGGED_QUERY_LENGTH)}…` : collapsed;
}

function labelForUriString(uriString: string): string {
  const uri = vscode.Uri.parse(uriString);
  if (uri.scheme === "untitled") {
    return uri.path || "Untitled";
  }
  const segments = uri.path.split("/");
  return segments[segments.length - 1] || uri.path;
}

/**
 * Backs the docked "SuiteQL Results" panel view. Tracks one `QueryExecutionState` per
 * *document* (keyed by its URI string), not a single shared session — so running
 * queries from several open SuiteQL tabs keeps each tab's results separate, and
 * switching the active editor switches which tab's results are shown, with a visible
 * label so it's never ambiguous which query a result set belongs to.
 */
export class ResultsViewProvider implements vscode.WebviewViewProvider {
  private view: vscode.WebviewView | undefined;
  private fetchAllChecked = false;
  private readonly executions = new Map<string, QueryExecutionState>();
  private displayedUri: string | undefined;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly activeConnection: ActiveConnectionManager,
  ) {
    vscode.window.onDidChangeActiveTextEditor((editor) => this.handleActiveEditorChanged(editor));
    vscode.workspace.onDidCloseTextDocument((document) => this.executions.delete(document.uri.toString()));
  }

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, "dist")],
    };
    webviewView.webview.html = this.renderHtml(webviewView.webview);

    webviewView.webview.onDidReceiveMessage((message: ResultsInboundMessage) => {
      switch (message.type) {
        case "ready":
          this.postActiveDocumentState();
          return;
        case "fetchAllChanged":
          this.fetchAllChecked = message.value;
          return;
        case "requestExport":
          void this.handleExport(message.format);
          return;
      }
    });

    webviewView.onDidDispose(() => {
      this.view = undefined;
    });
  }

  getFetchAll(): boolean {
    return this.fetchAllChecked;
  }

  isAnyExecutionRunning(): boolean {
    return [...this.executions.values()].some((state) => state.status === "running");
  }

  /** Stops every currently-running "fetch all" pagination loop from requesting further pages. */
  requestCancelCurrentExecution(): void {
    for (const state of this.executions.values()) {
      if (state.status === "running") {
        state.cancelRequested = true;
      }
    }
  }

  /** Resolves once every currently-running execution finishes, is cancelled, or errors. */
  async waitForCurrentExecution(): Promise<void> {
    await Promise.all(
      [...this.executions.values()].map((state) => state.currentExecution).filter((p): p is Thenable<void> => Boolean(p)),
    );
  }

  private handleActiveEditorChanged(editor: vscode.TextEditor | undefined): void {
    if (!editor || editor.document.languageId !== "suiteql") {
      return; // keep showing whatever was last displayed rather than blanking on unrelated focus changes
    }
    this.displayedUri = editor.document.uri.toString();
    this.postActiveDocumentState();
  }

  async runQuery(queryText: string, documentUri: vscode.Uri): Promise<void> {
    const active = this.activeConnection.get();
    if (!active) {
      void vscode.window.showErrorMessage("SuiteQL: no active connection.");
      return;
    }

    this.view?.show(true);

    const uriKey = documentUri.toString();
    const label = labelForUriString(uriKey);
    this.displayedUri = uriKey;

    const fetchAll = this.fetchAllChecked;
    const state: QueryExecutionState = {
      queryText,
      fetchAll,
      status: "running",
      columns: [],
      rows: [],
      totalRows: 0,
      hitRowCap: false,
      messages: [],
      cancelRequested: false,
    };
    this.executions.set(uriKey, state);
    this.post({ type: "queryStarted", sourceUri: uriKey, label, queryText, fetchAll });

    const startedAt = Date.now();
    logInfo(
      `Running query on "${active.profile.label}" for ${label} (${fetchAll ? "fetch all" : `capped at ${DEFAULT_ROW_CAP} rows`}): ${oneLine(queryText)}`,
    );

    const client = new SuiteQLClient(active.config);
    let pageNumber = 0;

    const execution = vscode.window.withProgress(
      { location: vscode.ProgressLocation.Window, title: `SuiteQL: running query (${label})…` },
      async (progress) => {
        try {
          if (!fetchAll) {
            const result = await client.executeQuery(queryText, DEFAULT_ROW_CAP, 0);
            pageNumber += 1;
            logInfo(`Page ${pageNumber} (${label}): ${result.items.length} row(s) at offset 0 (hasMore=${result.hasMore}).`);
            this.appendPage(uriKey, state, result.items);
            state.totalRows = result.items.length;
            state.hitRowCap = result.hasMore;
            progress.report({ message: `${state.totalRows} row(s)` });
          } else {
            let offset = 0;
            for (;;) {
              const result = await client.executeQuery(queryText, undefined, offset);
              pageNumber += 1;
              logInfo(
                `Page ${pageNumber} (${label}): ${result.items.length} row(s) at offset ${offset} (hasMore=${result.hasMore}).`,
              );
              this.appendPage(uriKey, state, result.items);
              state.totalRows += result.items.length;
              offset += result.items.length;
              progress.report({ message: `${state.totalRows} row(s) so far…` });
              if (state.cancelRequested) {
                logInfo(`Query cancelled by user for ${label} after ${state.totalRows} row(s).`);
                const cancelMessage: SerializedQueryMessage = {
                  text: "Stopped by user before finishing.",
                  level: "warning",
                };
                state.messages.push(cancelMessage);
                this.postIfDisplayed(uriKey, { type: "queryMessage", sourceUri: uriKey, ...cancelMessage });
                break;
              }
              if (!result.hasMore || result.items.length === 0) {
                break;
              }
              if (offset > active.config.maxOffset) {
                logInfo(`Stopping (${label}): offset ${offset} exceeded maxOffset ${active.config.maxOffset}.`);
                break;
              }
            }
          }
          state.status = "done";
          const durationMs = Date.now() - startedAt;
          logInfo(
            `Query finished for ${label}: ${state.totalRows} row(s) in ${pageNumber} page(s), ${durationMs}ms.${state.hitRowCap ? " (row cap reached — more rows available)" : ""}`,
          );
          this.postIfDisplayed(uriKey, {
            type: "queryDone",
            sourceUri: uriKey,
            totalRows: state.totalRows,
            hitRowCap: state.hitRowCap,
          });
        } catch (error) {
          state.status = "error";
          state.errorMessage = presentError(error);
          logError(`Query execution failed for ${label} after ${pageNumber} page(s) and ${state.totalRows} row(s)`, error);
          this.postIfDisplayed(uriKey, { type: "queryError", sourceUri: uriKey, message: state.errorMessage });
        }
      },
    );

    state.currentExecution = execution;
    await execution;
  }

  private appendPage(uriKey: string, state: QueryExecutionState, items: Array<Record<string, unknown>>): void {
    if (state.columns.length === 0 && items.length > 0) {
      state.columns = Object.keys(items[0]);
    }
    state.rows.push(...items);
    this.postIfDisplayed(uriKey, {
      type: "resultsPage",
      sourceUri: uriKey,
      columns: state.columns,
      rows: items,
      totalSoFar: state.rows.length,
    });
  }

  private postActiveDocumentState(): void {
    const uriKey = this.displayedUri;
    const state = uriKey ? this.executions.get(uriKey) : undefined;
    this.post({
      type: "activeDocumentChanged",
      sourceUri: uriKey,
      label: uriKey ? labelForUriString(uriKey) : undefined,
      state: state ? serializeState(state) : undefined,
    });
  }

  private async handleExport(format: "csv" | "json"): Promise<void> {
    const state = this.displayedUri ? this.executions.get(this.displayedUri) : undefined;
    if (!state || state.rows.length === 0) {
      this.post({ type: "exportResult", status: "failed", message: "No results to export." });
      return;
    }

    const filters: Record<string, string[]> = format === "csv" ? { CSV: ["csv"] } : { JSON: ["json"] };
    const target = await vscode.window.showSaveDialog({ filters });
    if (!target) {
      return;
    }

    try {
      const content = format === "csv" ? toCsv(state.columns, state.rows) : toJson(state.rows);
      await vscode.workspace.fs.writeFile(target, Buffer.from(content, "utf8"));
      this.post({ type: "exportResult", status: "success", message: `Exported to ${target.fsPath}` });
    } catch (error) {
      logError("Export failed", error);
      this.post({ type: "exportResult", status: "failed", message: presentError(error) });
    }
  }

  private postIfDisplayed(uriKey: string, message: ResultsOutboundMessage): void {
    if (this.displayedUri === uriKey) {
      this.post(message);
    }
  }

  private post(message: ResultsOutboundMessage): void {
    void this.view?.webview.postMessage(message);
  }

  private renderHtml(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "dist", "webviews", "resultsPane.js"),
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "dist", "webviews", "resultsPane.css"),
    );
    const nonce = randomBytes(16).toString("base64");

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="stylesheet" href="${styleUri}">
  <title>SuiteQL Results</title>
</head>
<body>
  <div class="toolbar">
    <span id="active-doc-label">No SuiteQL editor active</span>
    <label class="fetch-all">
      <input type="checkbox" id="fetch-all-checkbox">
      Fetch all rows (default cap: ${DEFAULT_ROW_CAP})
    </label>
    <div class="spacer"></div>
    <button id="export-csv" disabled>Export CSV</button>
    <button id="export-json" disabled>Export JSON</button>
  </div>
  <div id="status"></div>
  <div id="messages"></div>
  <div id="grid-container">
    <table id="grid"><thead><tr></tr></thead><tbody></tbody></table>
  </div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}

function serializeState(state: QueryExecutionState): SerializedQueryState {
  return {
    queryText: state.queryText,
    fetchAll: state.fetchAll,
    status: state.status,
    columns: state.columns,
    rows: state.rows,
    totalRows: state.totalRows,
    hitRowCap: state.hitRowCap,
    errorMessage: state.errorMessage,
    messages: state.messages,
  };
}
