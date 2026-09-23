import { randomBytes } from "node:crypto";
import * as vscode from "vscode";
import { SuiteQLClient } from "../../vendor/netsuite-api-client-ts/index.js";
import type { ActiveConnectionManager } from "../connection/activeConnection.js";
import { presentError } from "../errors/errorPresenter.js";
import { logError, logInfo, logWarning } from "../outputChannel.js";
import { buildFieldTypesForQuery } from "../schemaCache/columnTypeCoercion.js";
import type { ActiveSchemaCache } from "../schemaCache/activeSchemaCache.js";
import { toCsv } from "./exporters/csvExporter.js";
import { toJson } from "./exporters/jsonExporter.js";
import { mergeColumns, normalizeRowCasing } from "./mergeColumns.js";
import { parseSelectColumns } from "./parseSelectColumns.js";
import {
  DEFAULT_ROW_CAP,
  MAX_RENDERED_ROWS,
  type ResultsInboundMessage,
  type ResultsOutboundMessage,
  type SerializedQueryMessage,
  type SerializedQueryState,
} from "./resultsProtocol.js";

interface QueryExecutionState {
  queryText: string;
  /** The connection the query ran on — JSON export only applies that connection's schema types. */
  profileId: string;
  fetchAll: boolean;
  status: "running" | "done" | "error";
  columns: string[];
  rows: Array<Record<string, unknown>>;
  totalRows: number;
  hitRowCap: boolean;
  errorMessage?: string;
  messages: SerializedQueryMessage[];
  cancelRequested: boolean;
  /** Owned by this state (not shared/recreated), so `requestCancelCurrentExecution` and a
   * superseding `runQuery` call can both abort the in-flight request without needing a
   * reference into the `withProgress` closure that created it. */
  abortController: AbortController;
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
export class ResultsViewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  private view: vscode.WebviewView | undefined;
  private readonly disposables: vscode.Disposable[] = [];
  private fetchAllChecked = false;
  /** The latest execution started per document — what's displayed/exported. A document
   * entry is replaced (not removed) when a new run supersedes it; see `liveExecutions`
   * below for tracking a superseded-but-still-settling execution. */
  private readonly executions = new Map<string, QueryExecutionState>();
  /** Every execution that's still running, including one just superseded by a newer run
   * for the same document (cancelled, but not yet settled) — so cancel-all/wait-for-all
   * still reach it even though `executions` no longer points at it. */
  private readonly liveExecutions = new Set<QueryExecutionState>();
  private displayedUri: string | undefined;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly activeConnection: ActiveConnectionManager,
    private readonly schemaCache: ActiveSchemaCache,
  ) {
    this.disposables.push(
      vscode.window.onDidChangeActiveTextEditor((editor) => this.handleActiveEditorChanged(editor)),
      vscode.workspace.onDidCloseTextDocument((document) => this.executions.delete(document.uri.toString())),
    );
  }

  dispose(): void {
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
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
          // A (re)created webview always renders the checkbox unchecked — resync it, or a
          // hidden-then-shown panel would show "capped" while runs actually fetch everything.
          this.post({ type: "fetchAllState", value: this.fetchAllChecked });
          this.postActiveDocumentState();
          return;
        case "fetchAllChanged":
          this.fetchAllChecked = message.value;
          return;
        case "requestExport":
          void this.handleExport(message.format);
          return;
        case "clearResults":
          this.clearDisplayedResults();
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
    return this.liveExecutions.size > 0;
  }

  /** Stops every currently-running execution (including a "fetch all" pagination loop) by
   * both flagging it and aborting its in-flight HTTP request — a flag alone leaves a
   * request already sent running to completion (or its own retry budget) before the next
   * cancellation check point is reached. */
  requestCancelCurrentExecution(): void {
    for (const state of this.liveExecutions) {
      state.cancelRequested = true;
      state.abortController.abort();
    }
  }

  /** Resolves once every currently-running execution finishes, is cancelled, or errors. */
  async waitForCurrentExecution(): Promise<void> {
    await Promise.all(
      [...this.liveExecutions].map((state) => state.currentExecution).filter((p): p is Thenable<void> => Boolean(p)),
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

    if (this.view) {
      this.view.show(true);
    } else {
      // Never resolved yet (the panel has never been opened this session): `view.show` has
      // nothing to call, so open it via its generated focus command. Once it resolves, its
      // "ready" message pulls the current state, including this run's.
      void vscode.commands.executeCommand("suiteql.resultsPane.focus");
    }

    const uriKey = documentUri.toString();
    const label = labelForUriString(uriKey);
    this.displayedUri = uriKey;

    // A still-running execution for this same document (e.g. Run Query pressed again
    // before the previous run finished) would otherwise keep posting pages/mutating its
    // own state indefinitely, interleaved with the new run's — both nominally "for" the
    // same uriKey. Cancel it; `liveExecutions` keeps tracking it until it actually
    // settles, and the `isCurrentExecution` guards below stop it from posting or mutating
    // state any further now that `executions` is about to point at the new run instead.
    const previous = this.executions.get(uriKey);
    if (previous && previous.status === "running") {
      logInfo(`Superseding a still-running query for ${label} with a newly started one.`);
      previous.cancelRequested = true;
      previous.abortController.abort();
    }

    const fetchAll = this.fetchAllChecked;
    const state: QueryExecutionState = {
      queryText,
      profileId: active.profile.id,
      fetchAll,
      status: "running",
      // Pre-populated from the query's own SELECT list (best-effort — see
      // parseSelectColumns.ts) so a column that's null across the entire result set still
      // shows up, rather than only ever appearing once some row actually has a value for
      // it (what mergeColumns.ts alone, called per page below, can offer).
      columns: parseSelectColumns(queryText),
      rows: [],
      totalRows: 0,
      hitRowCap: false,
      messages: [],
      cancelRequested: false,
      abortController: new AbortController(),
    };
    this.executions.set(uriKey, state);
    this.liveExecutions.add(state);
    this.post({ type: "queryStarted", sourceUri: uriKey, label, queryText, fetchAll });

    const startedAt = Date.now();
    logInfo(
      `Running query on "${active.profile.label}" for ${label} (${fetchAll ? "fetch all" : `capped at ${DEFAULT_ROW_CAP} rows`}): ${oneLine(queryText)}`,
    );

    const client = new SuiteQLClient(active.config);
    let pageNumber = 0;

    const execution = vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `SuiteQL: running query (${label})…`,
        cancellable: true,
      },
      async (progress, token) => {
        const abortController = state.abortController;
        token.onCancellationRequested(() => {
          state.cancelRequested = true;
          abortController.abort();
        });

        try {
          if (!fetchAll) {
            const result = await client.executeQuery(queryText, DEFAULT_ROW_CAP, 0, abortController.signal);
            if (state.cancelRequested) {
              logInfo(`Query cancelled by user for ${label} (result discarded).`);
              const cancelMessage: SerializedQueryMessage = { text: "Cancelled by user.", level: "warning" };
              state.messages.push(cancelMessage);
              state.status = "done";
              this.postIfDisplayed(uriKey, state, { type: "queryMessage", sourceUri: uriKey, ...cancelMessage });
              this.postIfDisplayed(uriKey, state, { type: "queryDone", sourceUri: uriKey, totalRows: 0, hitRowCap: false });
              return;
            }
            pageNumber += 1;
            logInfo(`Page ${pageNumber} (${label}): ${result.items.length} row(s) at offset 0 (hasMore=${result.hasMore}).`);
            this.appendPage(uriKey, state, result.items);
            state.totalRows = result.items.length;
            state.hitRowCap = result.hasMore;
            progress.report({ message: `${state.totalRows} row(s)` });
          } else {
            let offset = 0;
            for (;;) {
              const result = await client.executeQuery(queryText, undefined, offset, abortController.signal);
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
                this.postIfDisplayed(uriKey, state, { type: "queryMessage", sourceUri: uriKey, ...cancelMessage });
                break;
              }
              if (!result.hasMore || result.items.length === 0) {
                break;
              }
              if (offset > active.config.maxOffset) {
                logInfo(`Stopping (${label}): offset ${offset} exceeded maxOffset ${active.config.maxOffset}.`);
                const offsetLimitMessage: SerializedQueryMessage = {
                  text: `Stopped after ${state.totalRows} row(s): the result set is larger than the maximum paging offset (${active.config.maxOffset}). Narrow the query to see the rest.`,
                  level: "warning",
                };
                state.messages.push(offsetLimitMessage);
                this.postIfDisplayed(uriKey, state, { type: "queryMessage", sourceUri: uriKey, ...offsetLimitMessage });
                break;
              }
            }
          }
          state.status = "done";
          const durationMs = Date.now() - startedAt;
          logInfo(
            `Query finished for ${label}: ${state.totalRows} row(s) in ${pageNumber} page(s), ${durationMs}ms.${state.hitRowCap ? " (row cap reached — more rows available)" : ""}`,
          );
          this.postIfDisplayed(uriKey, state, {
            type: "queryDone",
            sourceUri: uriKey,
            totalRows: state.totalRows,
            hitRowCap: state.hitRowCap,
          });
        } catch (error) {
          if (state.cancelRequested) {
            // A cancelled in-flight request surfaces here as a rejection (an abort, or
            // whatever the request happened to fail with right as it was aborted) — never
            // present that as a query error.
            logInfo(`Query cancelled by user for ${label} after ${pageNumber} page(s) and ${state.totalRows} row(s).`);
            const cancelMessage: SerializedQueryMessage = { text: "Cancelled by user.", level: "warning" };
            state.messages.push(cancelMessage);
            state.status = "done";
            this.postIfDisplayed(uriKey, state, { type: "queryMessage", sourceUri: uriKey, ...cancelMessage });
            this.postIfDisplayed(uriKey, state, {
              type: "queryDone",
              sourceUri: uriKey,
              totalRows: state.totalRows,
              hitRowCap: state.hitRowCap,
            });
            return;
          }
          state.status = "error";
          state.errorMessage = presentError(error);
          logError(`Query execution failed for ${label} after ${pageNumber} page(s) and ${state.totalRows} row(s)`, error);
          this.postIfDisplayed(uriKey, state, { type: "queryError", sourceUri: uriKey, message: state.errorMessage });
        }
      },
    ).then(() => {
      this.liveExecutions.delete(state);
    });

    state.currentExecution = execution;
    await execution;
  }

  /** Guards against a superseded execution (cancelled by a newer run for the same
   * document, but not yet settled — see `liveExecutions`) still posting to the webview or
   * mutating shared state after `executions` has already moved on to the run that
   * replaced it. */
  private isCurrentExecution(uriKey: string, state: QueryExecutionState): boolean {
    return this.executions.get(uriKey) === state;
  }

  private appendPage(uriKey: string, state: QueryExecutionState, items: Array<Record<string, unknown>>): void {
    if (!this.isCurrentExecution(uriKey, state)) {
      return;
    }
    mergeColumns(state.columns, items);
    // Rewritten to state.columns' canonical casing before being stored or sent anywhere —
    // the webview grid and the CSV exporter look each cell up by state.columns' names, and
    // the JSON exporter serializes each row's own keys, so all three need every row keyed
    // consistently, not in whatever casing this particular page happened to return (see
    // normalizeRowCasing's own doc comment in mergeColumns.ts).
    const normalizedItems = normalizeRowCasing(state.columns, items);
    const alreadyRendered = Math.min(state.rows.length, MAX_RENDERED_ROWS);
    for (const item of normalizedItems) {
      state.rows.push(item); // not push(...spread): a single huge page would overflow the call stack
    }
    this.postIfDisplayed(uriKey, state, {
      type: "resultsPage",
      sourceUri: uriKey,
      columns: state.columns,
      // Only what still fits in the grid (see MAX_RENDERED_ROWS) — every row stays in state.rows for export.
      rows: normalizedItems.slice(0, Math.max(0, MAX_RENDERED_ROWS - alreadyRendered)),
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

  /** Backs the results pane's "Clear" button: forgets the displayed document's finished result set. */
  private clearDisplayedResults(): void {
    const uriKey = this.displayedUri;
    const state = uriKey ? this.executions.get(uriKey) : undefined;
    if (!uriKey || !state || state.status === "running") {
      return; // nothing to clear, or still running (the button is disabled then anyway)
    }
    this.executions.delete(uriKey);
    this.postActiveDocumentState();
  }

  private async handleExport(format: "csv" | "json"): Promise<void> {
    const state = this.displayedUri ? this.executions.get(this.displayedUri) : undefined;
    if (!state || state.rows.length === 0) {
      this.post({ type: "exportResult", status: "failed", message: "No results to export." });
      return;
    }
    if (state.status === "running") {
      this.post({ type: "exportResult", status: "failed", message: "The query is still running — export once it finishes." });
      return;
    }

    const filters: Record<string, string[]> = format === "csv" ? { CSV: ["csv"] } : { JSON: ["json"] };
    const target = await vscode.window.showSaveDialog({ filters });
    if (!target) {
      return;
    }

    try {
      let content: string;
      if (format === "csv") {
        content = toCsv(state.columns, state.rows);
      } else {
        // Only the schema of the connection this query actually ran on — after switching
        // connections, the active cache describes a different account's tables.
        const cache = this.schemaCache.get();
        const fieldTypes =
          cache && cache.profileId === state.profileId ? buildFieldTypesForQuery(state.queryText, cache) : undefined;
        content = toJson(state.rows, fieldTypes, (message, details) => logWarning(message, details));
      }
      await vscode.workspace.fs.writeFile(target, Buffer.from(content, "utf8"));
      this.post({ type: "exportResult", status: "success", message: `Exported to ${target.fsPath}` });
    } catch (error) {
      logError("Export failed", error);
      this.post({ type: "exportResult", status: "failed", message: presentError(error) });
    }
  }

  private postIfDisplayed(uriKey: string, state: QueryExecutionState, message: ResultsOutboundMessage): void {
    if (this.displayedUri === uriKey && this.isCurrentExecution(uriKey, state)) {
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
    <button id="clear-results" disabled title="Clear the results shown for this file">Clear</button>
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
    rows: state.rows.slice(0, MAX_RENDERED_ROWS),
    storedRows: state.rows.length,
    totalRows: state.totalRows,
    hitRowCap: state.hitRowCap,
    errorMessage: state.errorMessage,
    messages: state.messages,
  };
}
