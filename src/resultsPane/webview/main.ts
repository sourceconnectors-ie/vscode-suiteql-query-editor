import {
  MAX_RENDERED_ROWS,
  type ResultsInboundMessage,
  type ResultsOutboundMessage,
  type SerializedQueryState,
} from "../resultsProtocol.js";

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
const clearButton = byId<HTMLButtonElement>("clear-results");

let currentColumns: string[] = [];
/** Whether the displayed document has a result set (or error) that "Clear" could remove. */
let hasState = false;
let running = false;

function columnsEqual(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((value, i) => value === b[i]);
}

function renderHeader(columns: string[]): void {
  currentColumns = columns;
  headRow.replaceChildren();
  for (const column of columns) {
    const th = document.createElement("th");
    th.textContent = column;
    headRow.appendChild(th);
  }
}

/** Appends rows up to {@link MAX_RENDERED_ROWS} in total — the host already stops sending past that, this just enforces it. */
function appendRows(rows: Array<Record<string, unknown>>): void {
  for (const row of rows) {
    if (body.childElementCount >= MAX_RENDERED_ROWS) {
      return;
    }
    const tr = document.createElement("tr");
    for (const column of currentColumns) {
      const td = document.createElement("td");
      // Own keys only — a missing (null) column named e.g. "constructor" must render blank,
      // not Object.prototype's member (see csvExporter.ts).
      const value = Object.hasOwn(row, column) ? row[column] : undefined;
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

/** Export needs finished rows; Clear needs something to clear. Neither is allowed mid-run. */
function updateButtons(): void {
  const canExport = !running && body.childElementCount > 0;
  exportCsvButton.disabled = !canExport;
  exportJsonButton.disabled = !canExport;
  clearButton.disabled = running || !hasState;
}

/** Appended to a row-count status line when the grid is showing fewer rows than exist. */
function renderCapNote(storedRows: number): string {
  return storedRows > MAX_RENDERED_ROWS
    ? ` Showing the first ${MAX_RENDERED_ROWS} in the grid — export to get all ${storedRows}.`
    : "";
}

function doneStatus(totalRows: number, hitRowCap: boolean): string {
  const base = hitRowCap
    ? `${totalRows} row(s) shown (capped — check "Fetch all" and re-run for the full result set).`
    : `${totalRows} row(s).`;
  return base + renderCapNote(totalRows);
}

function renderFullState(label: string | undefined, state: SerializedQueryState | undefined): void {
  clearGrid();
  messagesEl.replaceChildren();
  activeDocLabelEl.textContent = label ? `Results for: ${label}` : "No SuiteQL editor active";
  hasState = state !== undefined;
  running = state?.status === "running";

  if (!state) {
    statusEl.textContent = label ? "No results yet — run a query in this file." : "";
    updateButtons();
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
    statusEl.textContent = `${state.storedRows} row(s) so far…${renderCapNote(state.storedRows)}`;
  } else if (state.status === "error") {
    statusEl.textContent = "Query failed.";
    if (state.errorMessage) {
      addMessage(state.errorMessage, "error");
    }
  } else {
    statusEl.textContent = doneStatus(state.totalRows, state.hitRowCap);
  }

  updateButtons();
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

clearButton.addEventListener("click", () => {
  vscode.postMessage({ type: "clearResults" });
});

window.addEventListener("message", (event: MessageEvent<ResultsOutboundMessage>) => {
  const message = event.data;

  switch (message.type) {
    case "activeDocumentChanged":
      renderFullState(message.label, message.state);
      return;

    case "fetchAllState":
      fetchAllCheckbox.checked = message.value;
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
      hasState = true;
      running = true;
      updateButtons();
      return;

    case "resultsPage":
      // Not just the first page: a later page can reveal a column that was null (and so
      // omitted from the row's JSON entirely — see resultsViewProvider.ts's mergeColumns)
      // throughout every earlier page, or correct a column's casing once a differently-
      // cased key for the same column is seen (NetSuite doesn't guarantee consistent
      // column-name casing across pages — see mergeColumns.ts). Either case can leave the
      // array the same length as before, so re-render on any content change, not just
      // growth.
      if (!columnsEqual(message.columns, currentColumns)) {
        renderHeader(message.columns);
      }
      appendRows(message.rows);
      statusEl.textContent = `${message.totalSoFar} row(s) so far…${renderCapNote(message.totalSoFar)}`;
      return;

    case "queryDone":
      statusEl.textContent = doneStatus(message.totalRows, message.hitRowCap);
      running = false;
      updateButtons();
      return;

    case "queryError":
      statusEl.textContent = "Query failed.";
      addMessage(message.message, "error");
      running = false;
      updateButtons();
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
