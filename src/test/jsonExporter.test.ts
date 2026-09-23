import * as assert from "assert";
import { toJson } from "../resultsPane/exporters/jsonExporter.js";
import type { FieldTypeInfo } from "../../vendor/netsuite-api-client-ts/index.js";

suite("toJson", () => {
  test("passes rows through unchanged with no field types (existing behavior)", () => {
    const rows = [{ id: "1", entityid: "Acme" }];
    assert.strictEqual(toJson(rows), JSON.stringify(rows, null, 2));
  });

  test("coerces mapped columns to their real JSON type instead of leaving them quoted strings", () => {
    const rows = [{ id: "42", isperson: "T", balance: "199.99", entityid: "Acme" }];
    const fieldTypes = new Map<string, FieldTypeInfo>([
      ["id", { dataType: "integer" }],
      ["isperson", { dataType: "boolean" }],
      ["balance", { dataType: "number" }],
    ]);

    const parsed = JSON.parse(toJson(rows, fieldTypes)) as Record<string, unknown>[];

    assert.deepStrictEqual(parsed, [{ id: 42, isperson: true, balance: 199.99, entityid: "Acme" }]);
  });

  test("leaves a column with no mapped type as the original string", () => {
    const rows = [{ id: "1", freeformnote: "some text" }];
    const fieldTypes = new Map<string, FieldTypeInfo>([["id", { dataType: "integer" }]]);

    const parsed = JSON.parse(toJson(rows, fieldTypes)) as Record<string, unknown>[];

    assert.strictEqual(parsed[0].freeformnote, "some text");
  });

  test("coerces an empty string to null for a mapped column, not to 0/false", () => {
    const rows = [{ id: "" }];
    const fieldTypes = new Map<string, FieldTypeInfo>([["id", { dataType: "integer" }]]);

    const parsed = JSON.parse(toJson(rows, fieldTypes)) as Record<string, unknown>[];

    assert.strictEqual(parsed[0].id, null);
  });

  test("falls back to the original string and reports a warning when a value can't be coerced", () => {
    const rows = [{ id: "not-a-number" }];
    const fieldTypes = new Map<string, FieldTypeInfo>([["id", { dataType: "integer" }]]);
    const warnings: string[] = [];

    const parsed = JSON.parse(toJson(rows, fieldTypes, (message) => warnings.push(message))) as Record<string, unknown>[];

    assert.strictEqual(parsed[0].id, "not-a-number");
    assert.strictEqual(warnings.length, 1);
  });

  test("keeps a column named __proto__ when coercing (not swallowed by the prototype setter)", () => {
    const rows = [JSON.parse('{"id": "1", "__proto__": "x"}') as Record<string, unknown>];
    const fieldTypes = new Map<string, FieldTypeInfo>([["id", { dataType: "integer" }]]);
    const [parsed] = JSON.parse(toJson(rows, fieldTypes)) as Record<string, unknown>[];
    assert.ok(parsed);
    assert.deepStrictEqual(Object.keys(parsed), ["id", "__proto__"]);
  });
});
