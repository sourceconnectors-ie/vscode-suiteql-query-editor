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
});
