import * as assert from "assert";
import { toCsv } from "../resultsPane/exporters/csvExporter.js";

suite("toCsv", () => {
  test("writes a blank cell for a column missing from a row (NetSuite omits nulls)", () => {
    assert.strictEqual(toCsv(["id", "note"], [{ id: "1" }]), "id,note\r\n1,");
  });

  test("writes a blank cell, not an Object.prototype member, for a missing prototype-named column", () => {
    assert.strictEqual(toCsv(["id", "constructor", "__proto__"], [{ id: "1" }]), "id,constructor,__proto__\r\n1,,");
  });

  test("still writes a present __proto__ column's own value", () => {
    assert.strictEqual(toCsv(["__proto__"], [JSON.parse('{"__proto__": "x"}')]), "__proto__\r\nx");
  });
});
