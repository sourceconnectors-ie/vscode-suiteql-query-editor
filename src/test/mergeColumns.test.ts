import * as assert from "assert";
import { mergeColumns } from "../resultsPane/mergeColumns.js";

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
    assert.deepStrictEqual(columns, ["entityId"]);
  });

  test("corrects an existing column's stored casing in place rather than appending a duplicate", () => {
    const existing = ["id", "entityid", "trandate"];
    const columns = mergeColumns(existing, [{ ENTITYID: "Acme Corp" }]);
    assert.strictEqual(columns, existing);
    assert.deepStrictEqual(columns, ["id", "ENTITYID", "trandate"]);
  });

  test("case-insensitive matching still doesn't add a true duplicate for an exact-cased repeat", () => {
    const columns = mergeColumns(["id"], [{ id: "1" }, { id: "2" }]);
    assert.deepStrictEqual(columns, ["id"]);
  });
});
