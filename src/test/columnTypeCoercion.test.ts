import * as assert from "assert";
import { buildFieldTypesForQuery, toCoercibleType } from "../schemaCache/columnTypeCoercion.js";
import { emptySchemaCache, type SuiteQLTableSchema } from "../schemaCache/schemaCacheTypes.js";

function schemaWith(tableName: string, columns: Array<{ columnName: string; dataType: string }>): SuiteQLTableSchema {
  return {
    table: { tableName },
    columns: columns.map((column) => ({ columnName: column.columnName, dataType: column.dataType })),
    source: "restlet",
  };
}

suite("toCoercibleType", () => {
  test("maps known Records Catalog data types (case-insensitively)", () => {
    assert.strictEqual(toCoercibleType("INTEGER"), "integer");
    assert.strictEqual(toCoercibleType("integer"), "integer");
    assert.strictEqual(toCoercibleType("KEY"), "integer");
    assert.strictEqual(toCoercibleType("FLOAT"), "number");
    assert.strictEqual(toCoercibleType("CURRENCY"), "number");
    assert.strictEqual(toCoercibleType("CURRENCY_HIGH_PRECISION"), "number");
    assert.strictEqual(toCoercibleType("PERCENT"), "number");
    assert.strictEqual(toCoercibleType("BOOLEAN"), "boolean");
    assert.strictEqual(toCoercibleType("STRING"), "string");
    assert.strictEqual(toCoercibleType("DATE"), "string");
    assert.strictEqual(toCoercibleType("DATETIME"), "string");
    assert.strictEqual(toCoercibleType("CLOBTEXT"), "string");
    assert.strictEqual(toCoercibleType("DURATION"), "string");
  });

  test("returns undefined for an unrecognized data type", () => {
    assert.strictEqual(toCoercibleType("SOME_FUTURE_TYPE"), undefined);
    assert.strictEqual(toCoercibleType("unknown"), undefined);
  });
});

suite("buildFieldTypesForQuery", () => {
  test("only includes columns from tables the query actually references", () => {
    const cache = emptySchemaCache("profile", "realm");
    cache.schemas.customer = schemaWith("customer", [
      { columnName: "id", dataType: "INTEGER" },
      { columnName: "entityid", dataType: "STRING" },
    ]);
    cache.schemas.transaction = schemaWith("transaction", [{ columnName: "trandate", dataType: "DATE" }]);

    const fieldTypes = buildFieldTypesForQuery("select id, entityid from customer", cache);

    assert.strictEqual(fieldTypes.get("id")?.dataType, "integer");
    assert.strictEqual(fieldTypes.get("entityid")?.dataType, "string");
    assert.strictEqual(fieldTypes.has("trandate"), false);
  });

  test("includes columns from every joined table", () => {
    const cache = emptySchemaCache("profile", "realm");
    cache.schemas.customer = schemaWith("customer", [{ columnName: "id", dataType: "INTEGER" }]);
    cache.schemas.transaction = schemaWith("transaction", [{ columnName: "trandate", dataType: "DATE" }]);

    const fieldTypes = buildFieldTypesForQuery(
      "select t.trandate, c.id from transaction t join customer c on t.entity = c.id",
      cache,
    );

    assert.strictEqual(fieldTypes.get("trandate")?.dataType, "string");
    assert.strictEqual(fieldTypes.get("id")?.dataType, "integer");
  });

  test("excludes columns whose data type has no coercible mapping", () => {
    const cache = emptySchemaCache("profile", "realm");
    cache.schemas.customer = schemaWith("customer", [{ columnName: "weird", dataType: "SOME_FUTURE_TYPE" }]);

    const fieldTypes = buildFieldTypesForQuery("select weird from customer", cache);

    assert.strictEqual(fieldTypes.has("weird"), false);
  });

  test("returns an empty map for a query whose table isn't in the cache", () => {
    const cache = emptySchemaCache("profile", "realm");
    const fieldTypes = buildFieldTypesForQuery("select * from somethingnotcached", cache);
    assert.strictEqual(fieldTypes.size, 0);
  });

  test("resolves an aliased column using the underlying source column's type, not a same-named-but-unrelated schema column", () => {
    const cache = emptySchemaCache("profile", "realm");
    // "id" (integer) and "entityid" (string) both exist on customer — aliasing entityid to
    // "id" must not make the output column inherit customer.id's integer type.
    cache.schemas.customer = schemaWith("customer", [
      { columnName: "id", dataType: "INTEGER" },
      { columnName: "entityid", dataType: "STRING" },
    ]);

    const fieldTypes = buildFieldTypesForQuery("SELECT entityid AS id FROM customer", cache);

    assert.strictEqual(fieldTypes.get("id")?.dataType, "string");
  });

  test("falls back to keying by every referenced table's schema column name when the SELECT list can't be parsed (SELECT *)", () => {
    const cache = emptySchemaCache("profile", "realm");
    cache.schemas.customer = schemaWith("customer", [{ columnName: "entityid", dataType: "STRING" }]);

    const fieldTypes = buildFieldTypesForQuery("SELECT * FROM customer", cache);

    assert.strictEqual(fieldTypes.get("entityid")?.dataType, "string");
  });
});
