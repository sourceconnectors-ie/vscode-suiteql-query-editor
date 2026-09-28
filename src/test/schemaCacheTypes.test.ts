import * as assert from "assert";
import { buildAliasMap } from "../completion/scopeHeuristic.js";
import { buildFieldTypesForQuery } from "../schemaCache/columnTypeCoercion.js";
import { emptySchemaCache, getTableSchema, setTableSchema } from "../schemaCache/schemaCacheTypes.js";

suite("getTableSchema / setTableSchema", () => {
  test("misses, rather than returning an Object.prototype member, for prototype-named tables", () => {
    const cache = JSON.parse(JSON.stringify(emptySchemaCache("p", "r"))) as ReturnType<typeof emptySchemaCache>;
    assert.strictEqual(getTableSchema(cache, "constructor"), undefined);
    assert.strictEqual(getTableSchema(cache, "__proto__"), undefined);
    assert.strictEqual(getTableSchema(cache, "tostring"), undefined);
  });

  test("round-trips a table named __proto__ as an own key", () => {
    const cache = emptySchemaCache("p", "r");
    const schema = { table: { tableName: "__proto__" }, columns: [], source: "restlet" as const };
    setTableSchema(cache, "__proto__", schema);
    assert.deepStrictEqual(Object.keys(cache.schemas), ["__proto__"]);
    assert.strictEqual(getTableSchema(cache, "__proto__"), schema);
    assert.strictEqual(Object.getPrototypeOf(cache.schemas), Object.prototype);
  });

  test("buildFieldTypesForQuery doesn't throw for a query against a prototype-named table", () => {
    const cache = emptySchemaCache("p", "r");
    assert.doesNotThrow(() => buildFieldTypesForQuery("SELECT id FROM constructor c JOIN __proto__ p ON 1 = 1", cache));
  });
});

suite("buildAliasMap — prototype-named aliases", () => {
  test("misses for an unknown prototype-named alias and stores a __proto__ alias as a key", () => {
    const map = buildAliasMap("SELECT * FROM customer __proto__");
    assert.strictEqual(map["constructor"], undefined);
    assert.strictEqual(map["__proto__"], "customer");
  });
});
