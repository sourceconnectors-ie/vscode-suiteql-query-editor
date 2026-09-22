import type { ResultsInboundMessage, ResultsOutboundMessage, SerializedQueryState } from "../resultsProtocol.js";

declare function acquireVsCodeApi(): {
  postMessage(message: ResultsInboundMessage): void;
};

const vscode = acquireVsCodeApi();

function byId<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) {
    throw new Error(`Missing element #${id}`);
  }
  return el as T;
}

const activeDocLabelEl = byId<HTMLSpanElement>("active-doc-label");
const statusEl = byId<HTMLDivElement>("status");
const messagesEl = byId<HTMLDivElement>("messages");
const gridEl = byId<HTMLTableElement>("grid");
const headRow = gridEl.querySelector("thead tr") as HTMLTableRowElement;
const body = gridEl.querySelector("tbody") as HTMLTableSectionElement;
const fetchAllCheckbox = byId<HTMLInputElement>("fetch-all-checkbox");
const exportCsvButton = byId<HTMLButtonElement>("export-csv");
const exportJsonButton = byId<HTMLButtonElement>("export-json");

let currentColumns: string[] = [];

function renderHeader(columns: string[]): void {
  currentColumns = columns;
  headRow.replaceChildren();
  for (const column of columns) {
    const th = document.createElement("th");
    th.textContent = column;
    headRow.appendChild(th);
  }
}

function appendRows(rows: Array<Record<string, unknown>>): void {
  for (const row of rows) {
    const tr = document.createElement("tr");
    for (const column of currentColumns) {
      const td = document.createElement("td");
      const value = row[column];
      td.textContent = value === null || value === undefined ? "" : String(value);
      tr.appendChild(td);
    }
    body.appendChild(tr);
  }
}

function clearGrid(): void {
  currentColumns = [];
  headRow.replaceChildren();
  body.replaceChildren();
}

function addMessage(text: string, level: "info" | "warning" | "error"): void {
  const line = document.createElement("div");
  line.className = `message ${level}`;
  line.textContent = text;
  messagesEl.appendChild(line);
}

function setBusy(busy: boolean): void {
  exportCsvButton.disabled = busy || body.childElementCount === 0;
  exportJsonButton.disabled = busy || body.childElementCount === 0;
}

function renderFullState(label: string | undefined, state: SerializedQueryState | undefined): void {
  clearGrid();
  messagesEl.replaceChildren();
  activeDocLabelEl.textContent = label ? `Results for: ${label}` : "No SuiteQL editor active";

  if (!state) {
    statusEl.textContent = label ? "No results yet — run a query in this file." : "";
    exportCsvButton.disabled = true;
    exportJsonButton.disabled = true;
    return;
  }

  if (state.columns.length > 0) {
    renderHeader(state.columns);
  }
  appendRows(state.rows);
  for (const message of state.messages) {
    addMessage(message.text, message.level);
  }

  if (state.status === "running") {
    statusEl.textContent = `${state.totalRows || state.rows.length} row(s) so far…`;
  } else if (state.status === "error") {
    statusEl.textContent = "Query failed.";
    if (state.errorMessage) {
      addMessage(state.errorMessage, "error");
    }
  } else {
    statusEl.textContent = state.hitRowCap
      ? `${state.totalRows} row(s) shown (capped — check "Fetch all" and re-run for the full result set).`
      : `${state.totalRows} row(s).`;
  }

  exportCsvButton.disabled = state.rows.length === 0;
  exportJsonButton.disabled = state.rows.length === 0;
}

fetchAllCheckbox.addEventListener("change", () => {
  vscode.postMessage({ type: "fetchAllChanged", value: fetchAllCheckbox.checked });
});

exportCsvButton.addEventListener("click", () => {
  vscode.postMessage({ type: "requestExport", format: "csv" });
});

exportJsonButton.addEventListener("click", () => {
  vscode.postMessage({ type: "requestExport", format: "json" });
});

window.addEventListener("message", (event: MessageEvent<ResultsOutboundMessage>) => {
  const message = event.data;

  switch (message.type) {
    case "activeDocumentChanged":
      renderFullState(message.label, message.state);
      return;

    case "queryStarted":
      // No sourceUri re-check here (or in the message types below): the extension only
      // ever sends these for whichever document it considers "displayed" (see
      // `postIfDisplayed` in resultsViewProvider.ts), which switches to wherever a run
      // was started from — that's the single source of truth this webview defers to.
      clearGrid();
      messagesEl.replaceChildren();
      activeDocLabelEl.textContent = `Results for: ${message.label}`;
      statusEl.textContent = "Running query…";
      setBusy(true);
      return;

    case "resultsPage":
      // Not just the first page: a later page can reveal a column that was null (and so
      // omitted from the row's JSON entirely — see resultsViewProvider.ts's mergeColumns)
      // throughout every earlier page. Columns only ever grow, never reorder/shrink, so
      // this only fires when there's actually a new one to add to the header.
      if (message.columns.length > currentColumns.length) {
        renderHeader(message.columns);
      }
      appendRows(message.rows);
      statusEl.textContent = `${message.totalSoFar} row(s) so far…`;
      return;

    case "queryDone":
      statusEl.textContent = message.hitRowCap
        ? `${message.totalRows} row(s) shown (capped — check "Fetch all" and re-run for the full result set).`
        : `${message.totalRows} row(s).`;
      setBusy(false);
      return;

    case "queryError":
      statusEl.textContent = "Query failed.";
      addMessage(message.message, "error");
      setBusy(false);
      return;

    case "queryMessage":
      addMessage(message.text, message.level);
      return;

    case "exportResult":
      addMessage(message.message, message.status === "success" ? "info" : "error");
      return;
  }
});

vscode.postMessage({ type: "ready" });
