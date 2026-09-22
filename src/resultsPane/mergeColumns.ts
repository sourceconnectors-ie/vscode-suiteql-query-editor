/**
 * NetSuite's SuiteQL REST endpoint omits a row's null-valued columns entirely rather than
 * sending them as `null`/empty — so the column list can't be derived from any single row
 * (a naive `Object.keys(items[0])` silently drops any selected column that happened to be
 * null on that one row, most commonly the very first). Instead, `existingColumns` is
 * merged with every key seen across every row in `items`: a column is only ever added,
 * never removed or reordered — so a later page revealing a column that was null
 * throughout every earlier page still shows it, without disturbing columns already known
 * about. Mutates and returns `existingColumns` (matches `Array.prototype.push`'s own
 * convention) rather than allocating a new array on every page.
 *
 * Matching is case-insensitive: NetSuite doesn't guarantee consistent column-name casing
 * across pages of the same query (see Oracle's SuiteQL docs), so a naive case-sensitive
 * `includes` would treat e.g. "entityId" on page 1 and "entityid" on page 2 as two
 * different columns, producing a duplicate blank-looking column in the grid. The casing
 * seen *first* for a column is kept as its permanent canonical name — a later page's
 * differently-cased key for the same column is folded into the existing entry rather than
 * changing it or adding a duplicate. Canonical casing is deliberately never revised after
 * that: every row this module hands out (see `normalizeRowCasing`) is rewritten to match
 * it, so changing it later would mean retroactively rewriting every row already stored
 * from earlier pages — easy to miss, and exactly how a column can end up right in the grid
 * (whose header just got relabeled) but silently blank in a CSV/JSON export for any row
 * that came from a page using the old casing, since the exporters look values up by the
 * current column name.
 */
export function mergeColumns(existingColumns: string[], items: Array<Record<string, unknown>>): string[] {
  for (const item of items) {
    for (const key of Object.keys(item)) {
      if (!existingColumns.some((col) => col.toLowerCase() === key.toLowerCase())) {
        existingColumns.push(key);
      }
    }
  }
  return existingColumns;
}

/**
 * Rewrites each row's keys to `columns`' canonical casing (case-insensitively matched),
 * so every row this results pane stores or hands to the webview/exporters is keyed
 * consistently — see `mergeColumns` above for why this can't be skipped once a column's
 * canonical casing has been fixed. `columns` must already include every key present in
 * `items` (call `mergeColumns(columns, items)` first); a row key with no case-insensitive
 * match in `columns` is kept as-is rather than dropped, so this never silently loses data
 * even if that invariant is violated.
 */
export function normalizeRowCasing(
  columns: string[],
  items: Array<Record<string, unknown>>,
): Array<Record<string, unknown>> {
  return items.map((item) => {
    const normalized: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(item)) {
      const canonical = columns.find((col) => col.toLowerCase() === key.toLowerCase()) ?? key;
      normalized[canonical] = value;
    }
    return normalized;
  });
}
