import type { SuiteQLClient } from "./client.js";
import type { SuiteQLConfig } from "./config.js";
import { sleep } from "./retry.js";

export type ExtractionStatus = "COMPLETE" | "INCOMPLETE";
export type StopReason = "max_offset_exceeded" | "empty_page_with_more";

export interface ExtractionSummary {
  status: ExtractionStatus;
  totalRows: number;
  totalPages: number;
  durationSeconds: number;
  rowsPerSecond: number;
  lastOffset: number;
  /** Present only when the loop stopped early for a non-error reason. */
  stopReason?: StopReason;
}

export interface StreamState {
  lastOffset?: number;
}

/**
 * Paginates a SuiteQL query to exhaustion, yielding each row.
 *
 * Errors propagate instead of being swallowed: a query failure (including after
 * exhausted retries) propagates straight out of this generator so callers see the
 * actual failure rather than an ambiguous empty/partial result set.
 *
 * An empty page with `hasMore` still true stops pagination instead of looping forever.
 *
 * `offset > maxOffset` checked at the top of the loop before each request;
 * `offset += items.length` (not `+= limit`), so a short last page still advances
 * correctly; `queryDelay` sleep only when `hasMore` is true, never after the last page;
 * a column-mismatch warning when a later page's keys differ from the first page's.
 */
export async function* readRecords(
  client: SuiteQLClient,
  config: SuiteQLConfig,
  query: string,
  state?: StreamState,
  onWarning?: (message: string, details: Record<string, unknown>) => void,
): AsyncGenerator<Record<string, unknown>, ExtractionSummary, void> {
  const startTime = Date.now();
  let offset = state?.lastOffset ?? 0;
  const limit = config.defaultLimit;
  let totalRows = 0;
  let totalPages = 0;
  let schemaColumns: string[] | null = null;
  let hasMore = true;
  let stopReason: StopReason | undefined;

  while (hasMore) {
    if (offset > config.maxOffset) {
      onWarning?.("Reached max_offset limit, stopping pagination", {
        offset,
        maxOffset: config.maxOffset,
      });
      stopReason = "max_offset_exceeded";
      break;
    }

    // Intentionally not wrapped in try/catch — a query failure propagates straight
    // out of this generator.
    const result = await client.executeQuery(query, limit, offset);

    const items = result.items ?? [];
    const pageCount = items.length;
    totalPages += 1;

    if (items.length > 0) {
      const firstItem = items[0];
      const pageColumns = firstItem ? Object.keys(firstItem).sort() : [];
      if (schemaColumns === null) {
        schemaColumns = pageColumns;
      } else if (JSON.stringify(pageColumns) !== JSON.stringify(schemaColumns)) {
        onWarning?.("Column mismatch detected", { expected: schemaColumns, got: pageColumns, offset });
      }
    }

    for (const record of items) {
      yield record;
      totalRows += 1;
    }

    hasMore = result.hasMore ?? false;
    offset += pageCount;

    // Guard against an infinite loop: an empty page with hasMore still true would
    // otherwise spin forever, since offset never advances.
    if (pageCount === 0 && hasMore) {
      onWarning?.("Empty page returned with hasMore=true, stopping pagination", { offset });
      stopReason = "empty_page_with_more";
      break;
    }

    if (hasMore && config.queryDelay > 0) {
      await sleep(config.queryDelay);
    }
  }

  const durationSeconds = (Date.now() - startTime) / 1000;

  return {
    status: hasMore ? "INCOMPLETE" : "COMPLETE",
    totalRows,
    totalPages,
    durationSeconds,
    rowsPerSecond: durationSeconds > 0 ? totalRows / durationSeconds : 0,
    lastOffset: offset,
    ...(stopReason ? { stopReason } : {}),
  };
}
