import * as assert from "assert";
import { mergeColumns, normalizeRowCasing } from "../resultsPane/mergeColumns.js";

suite("mergeColumns", () => {
  test("does not miss a column that's only null (and so omitted from the JSON) on the first row", () => {
    const columns = mergeColumns([], [
      { id: "1", note: "hello" }, // NetSuite omits "note" entirely when it's null — not the case here
      { id: "2" }, // "note" is null on this row and simply absent, not present-as-null
    ]);
    assert.deepStrictEqual(columns, ["id", "note"]);
  });

  test("picks up a column that was null on every row of the first page, from a later page", () => {
    const columns = mergeColumns(["id"], [{ id: "3", extra: "value" }]);
    assert.deepStrictEqual(columns, ["id", "extra"]);
  });

  test("keeps first-seen order and never duplicates a column", () => {
    const columns = mergeColumns([], [
      { b: "1", a: "2" },
      { a: "3", c: "4" },
    ]);
    assert.deepStrictEqual(columns, ["b", "a", "c"]);
  });

  test("returns the same array instance it was given, mutated in place", () => {
    const existing: string[] = ["id"];
    const result = mergeColumns(existing, [{ id: "1", name: "x" }]);
    assert.strictEqual(result, existing);
    assert.deepStrictEqual(existing, ["id", "name"]);
  });

  test("is a no-op for an empty batch of items", () => {
    assert.deepStrictEqual(mergeColumns(["id"], []), ["id"]);
  });

  test("treats a differently-cased key for an already-known column as the same column, not a duplicate", () => {
    // NetSuite doesn't guarantee consistent column-name casing across pages of the same
    // query — a naive case-sensitive check would add "entityId" as a second, blank-looking
    // column alongside an already-known "entityid".
    const columns = mergeColumns(["entityid"], [{ entityId: "Acme Corp" }]);
    assert.deepStrictEqual(columns, ["entityid"]);
  });

  test("keeps the first-seen casing for an existing column rather than changing it to match a later page's differently-cased key", () => {
    // Canonical casing must stay stable once fixed — see mergeColumns.ts's doc comment:
    // changing it later would silently blank out earlier-paged rows in an export, since
    // they're stored keyed by whatever casing state.columns had when normalizeRowCasing
    // ran on them (which is exactly why normalizeRowCasing exists at all).
    const existing = ["id", "entityid", "trandate"];
    const columns = mergeColumns(existing, [{ ENTITYID: "Acme Corp" }]);
    assert.strictEqual(columns, existing);
    assert.deepStrictEqual(columns, ["id", "entityid", "trandate"]);
  });

  test("case-insensitive matching still doesn't add a true duplicate for an exact-cased repeat", () => {
    const columns = mergeColumns(["id"], [{ id: "1" }, { id: "2" }]);
    assert.deepStrictEqual(columns, ["id"]);
  });
});

suite("normalizeRowCasing", () => {
  test("rewrites a row's key to the canonical column casing, case-insensitively matched", () => {
    const [row] = normalizeRowCasing(["entityid"], [{ entityId: "Acme Corp" }]);
    assert.deepStrictEqual(row, { entityid: "Acme Corp" });
  });

  test("leaves an already-canonically-cased key untouched", () => {
    const [row] = normalizeRowCasing(["entityid", "id"], [{ entityid: "Acme Corp", id: "7" }]);
    assert.deepStrictEqual(row, { entityid: "Acme Corp", id: "7" });
  });

  test("normalizes every row in the batch independently", () => {
    const rows = normalizeRowCasing(["entityid"], [{ entityId: "Acme Corp" }, { ENTITYID: "Globex" }, { entityid: "Initech" }]);
    assert.deepStrictEqual(rows, [{ entityid: "Acme Corp" }, { entityid: "Globex" }, { entityid: "Initech" }]);
  });

  test("keeps a key with no case-insensitive match in columns as-is, rather than dropping it", () => {
    const [row] = normalizeRowCasing(["id"], [{ id: "1", unexpectedColumn: "x" }]);
    assert.deepStrictEqual(row, { id: "1", unexpectedColumn: "x" });
  });

  test("is the missing half of mergeColumns' casing fix: rows from differently-cased pages end up identically keyed, so no exporter/lookup silently loses a value", () => {
    const columns = mergeColumns([], [{ entityId: "Acme Corp" }]);
    const page1 = normalizeRowCasing(columns, [{ entityId: "Acme Corp" }]);
    mergeColumns(columns, [{ entityid: "Globex" }]); // a later page, differently cased — folded in, casing unchanged
    const page2 = normalizeRowCasing(columns, [{ entityid: "Globex" }]);

    const allRows = [...page1, ...page2];
    assert.deepStrictEqual(columns, ["entityId"]);
    // Both rows must be readable via the exact same (canonical) key — a naive
    // case-sensitive `row[column]` lookup (as the CSV exporter uses) would otherwise find
    // page 2's row `undefined` under "entityId", exporting a blank cell for real data.
    for (const row of allRows) {
      assert.ok(Object.prototype.hasOwnProperty.call(row, "entityId"), `expected row to have a canonically-cased "entityId" key: ${JSON.stringify(row)}`);
    }
    assert.deepStrictEqual(
      allRows.map((row) => row.entityId),
      ["Acme Corp", "Globex"],
    );
  });
});

suite("normalizeRowCasing — prototype-named columns", () => {
  // Built with JSON.parse: an object literal `{ __proto__: ... }` would set the prototype
  // instead of creating a key, which is exactly the bug under test.
  test("keeps a column named __proto__ as an own key, for a string value", () => {
    const [row] = normalizeRowCasing(["id", "__proto__"], [JSON.parse('{"id": "1", "__proto__": "x"}')]);
    assert.ok(row);
    assert.deepStrictEqual(Object.keys(row), ["id", "__proto__"]);
    assert.strictEqual(Object.getOwnPropertyDescriptor(row, "__proto__")?.value, "x");
    assert.strictEqual(Object.getPrototypeOf(row), Object.prototype);
  });

  test("keeps a column named __proto__ as an own key without swapping the row's prototype, for an object value", () => {
    const [row] = normalizeRowCasing(["__PROTO__"], [JSON.parse('{"__proto__": {"polluted": true}}')]);
    assert.ok(row);
    assert.deepStrictEqual(Object.keys(row), ["__PROTO__"]);
    assert.strictEqual(Object.getPrototypeOf(row), Object.prototype);
    assert.strictEqual((row as { polluted?: unknown }).polluted, undefined);
  });
});
