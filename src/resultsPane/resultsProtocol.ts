export const DEFAULT_ROW_CAP = 100;

/**
 * Most rows the results grid ever renders (and the extension host ever sends to it) for
 * one result set. A "fetch all" run can return hundreds of thousands of rows; rendering
 * every one as DOM rows, and re-sending them all on every editor switch, freezes the
 * webview. Every row is still kept host-side, so CSV/JSON export always has the full set.
 */
export const MAX_RENDERED_ROWS = 5000;

export interface SerializedQueryMessage {
  text: string;
  level: "info" | "warning" | "error";
}

/**
 * A snapshot of one document's query state, sent whenever the displayed tab switches.
 * `rows` holds at most {@link MAX_RENDERED_ROWS} rows; `totalRows`/`storedRows` say how
 * many there really are.
 */
export interface SerializedQueryState {
  queryText: string;
  fetchAll: boolean;
  status: "running" | "done" | "error";
  columns: string[];
  rows: Array<Record<string, unknown>>;
  /** Every row held host-side for this result set (what export writes). */
  storedRows: number;
  totalRows: number;
  hitRowCap: boolean;
  errorMessage?: string;
  messages: SerializedQueryMessage[];
}

export type ResultsInboundMessage =
  | { type: "ready" }
  | { type: "fetchAllChanged"; value: boolean }
  | { type: "requestExport"; format: "csv" | "json" }
  | { type: "clearResults" };

/**
 * Every per-query message carries `sourceUri` (the originating document). The webview
 * only applies these to its live view when `sourceUri` matches whatever it's currently
 * displaying — otherwise the update is silently dropped client-side (the extension host
 * still records it, so switching back to that tab shows the up-to-date state via
 * `activeDocumentChanged`).
 */
export type ResultsOutboundMessage =
  | {
      type: "activeDocumentChanged";
      sourceUri: string | undefined;
      label: string | undefined;
      state: SerializedQueryState | undefined;
    }
  | { type: "queryStarted"; sourceUri: string; label: string; queryText: string; fetchAll: boolean }
  | {
      type: "resultsPage";
      sourceUri: string;
      columns: string[];
      rows: Array<Record<string, unknown>>;
      totalSoFar: number;
    }
  | { type: "queryDone"; sourceUri: string; totalRows: number; hitRowCap: boolean }
  | { type: "queryError"; sourceUri: string; message: string }
  | { type: "queryMessage"; sourceUri: string; text: string; level: "info" | "warning" | "error" }
  | { type: "exportResult"; status: "success" | "failed"; message: string }
  /** Re-syncs the "Fetch all" checkbox after the webview is (re)created — it always renders unchecked. */
  | { type: "fetchAllState"; value: boolean };
