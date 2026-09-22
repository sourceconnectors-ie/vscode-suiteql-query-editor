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
 * different columns, producing a duplicate blank-looking column in the grid. Once a column
 * is known, a later page's differently-cased key for the same column corrects its stored
 * casing in place rather than adding a duplicate entry.
 */
export function mergeColumns(existingColumns: string[], items: Array<Record<string, unknown>>): string[] {
  for (const item of items) {
    for (const key of Object.keys(item)) {
      const existingIndex = existingColumns.findIndex((col) => col.toLowerCase() === key.toLowerCase());
      if (existingIndex === -1) {
        existingColumns.push(key);
      } else if (existingColumns[existingIndex] !== key) {
        existingColumns[existingIndex] = key;
      }
    }
  }
  return existingColumns;
}
