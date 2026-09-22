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
 */
export function mergeColumns(existingColumns: string[], items: Array<Record<string, unknown>>): string[] {
  for (const item of items) {
    for (const key of Object.keys(item)) {
      if (!existingColumns.includes(key)) {
        existingColumns.push(key);
      }
    }
  }
  return existingColumns;
}
