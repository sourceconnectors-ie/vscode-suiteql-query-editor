import * as assert from "assert";
import { coerceRow, Semaphore, type FieldTypeInfo } from "../../vendor/netsuite-api-client-ts/index.js";
import { findIdentifierTokens } from "../completion/semanticTokensProvider.js";
import { singleStatement, statementAtOffset } from "../queryEditor/statementAtCursor.js";
import { toCsv } from "../resultsPane/exporters/csvExporter.js";
import { parseSelectColumns } from "../resultsPane/parseSelectColumns.js";
import { buildTablePickerItems } from "../schemaCache/tablePicker.js";

suite("statementAtOffset", () => {
  const text = "select id from customer;\n\nselect id from vendor;";

  test("strips the trailing semicolon from a single statement", () => {
    assert.strictEqual(statementAtOffset("select id from customer;", 3), "select id from customer");
  });

  test("returns the statement under the cursor", () => {
    assert.strictEqual(statementAtOffset(text, text.indexOf("vendor")), "select id from vendor");
    assert.strictEqual(statementAtOffset(text, 2), "select id from customer");
  });

  test("between statements, returns the one just before the cursor", () => {
    assert.strictEqual(statementAtOffset(text, text.indexOf(";") + 1), "select id from customer");
  });

  test("ignores a semicolon inside a string literal", () => {
    assert.strictEqual(statementAtOffset("select 'a;b' from dual", 0), "select 'a;b' from dual");
  });

  test("returns undefined for a comment-only document", () => {
    assert.strictEqual(statementAtOffset("-- nothing here", 0), undefined);
  });

  test("singleStatement rejects a selection spanning two statements", () => {
    assert.throws(() => singleStatement(text));
    assert.strictEqual(singleStatement("select 1 from dual;"), "select 1 from dual");
  });
});

suite("parseSelectColumns (top-level SELECT)", () => {
  test("ignores a 'select' inside a leading comment", () => {
    assert.deepStrictEqual(parseSelectColumns("-- select all customers\nSELECT id, entityid FROM customer"), [
      "id",
      "entityid",
    ]);
  });

  test("ignores a 'select' inside a leading # comment", () => {
    assert.deepStrictEqual(parseSelectColumns("# select fake\nSELECT id FROM customer"), ["id"]);
  });

  test("uses the main SELECT, not a WITH clause's CTE body", () => {
    assert.deepStrictEqual(parseSelectColumns("WITH x AS (SELECT a FROM t) SELECT b FROM x"), ["b"]);
  });
});

suite("findIdentifierTokens (masking)", () => {
  test("does not match inside a block comment spanning lines", () => {
    const tokens = findIdentifierTokens(["/* customer", "customer */ select * from account"], new Set(["customer"]), new Set());
    assert.strictEqual(tokens.length, 0);
  });

  test("does not match inside a string literal spanning lines", () => {
    const tokens = findIdentifierTokens(["select 'a", "customer' from account"], new Set(["customer"]), new Set());
    assert.strictEqual(tokens.length, 0);
  });

  test("still matches after a block comment closes on the same line", () => {
    const tokens = findIdentifierTokens(["/* x */ select * from customer"], new Set(["customer"]), new Set());
    assert.deepStrictEqual(tokens, [{ line: 0, startChar: 22, length: 8, tokenType: "class" }]);
  });
});

suite("toCsv (formula neutralization)", () => {
  test("prefixes a formula-looking cell with a quote", () => {
    assert.strictEqual(toCsv(["note"], [{ note: "=HYPERLINK(\"x\")" }]), 'note\r\n"\'=HYPERLINK(""x"")"');
    assert.strictEqual(toCsv(["note"], [{ note: "@SUM(A1)" }]), "note\r\n'@SUM(A1)");
  });

  test("prefixes a cell that starts with a line feed", () => {
    assert.strictEqual(toCsv(["note"], [{ note: "\n=1+1" }]), 'note\r\n"\'\n=1+1"');
  });

  test("leaves negative and signed numbers numeric", () => {
    assert.strictEqual(toCsv(["amount"], [{ amount: "-12.50" }, { amount: "+3" }]), "amount\r\n-12.50\r\n+3");
  });
});

suite("buildTablePickerItems", () => {
  test("keeps a selected table that's missing from the index, pre-checked", () => {
    const items = buildTablePickerItems([{ tableName: "customer" }], new Set(["customer", "customrecord_x"]));
    const missing = items.find((item) => item.tableName === "customrecord_x");
    assert.ok(missing);
    assert.strictEqual(missing.picked, true);
    assert.strictEqual(items.length, 2);
  });

  test("pre-checks selected tables case-insensitively", () => {
    const items = buildTablePickerItems([{ tableName: "Customer" }], new Set(["customer"]));
    assert.strictEqual(items.length, 1);
    assert.strictEqual(items[0].picked, true);
  });
});

suite("coerceRow (precision)", () => {
  const fieldTypes = new Map<string, FieldTypeInfo>([
    ["id", { dataType: "integer" }],
    ["amount", { dataType: "number" }],
  ]);

  test("keeps an integer beyond 2^53 as its exact string", () => {
    assert.deepStrictEqual(coerceRow({ id: "9007199254740993" }, fieldTypes), { id: "9007199254740993" });
  });

  test("keeps a decimal with more significant digits than a double holds", () => {
    assert.deepStrictEqual(coerceRow({ amount: "1234567890.1234567891" }, fieldTypes), { amount: "1234567890.1234567891" });
  });

  test("still coerces ordinary values", () => {
    assert.deepStrictEqual(coerceRow({ id: "1000000000000000", amount: "199.990" }, fieldTypes), {
      id: 1000000000000000,
      amount: 199.99,
    });
  });
});

suite("Semaphore", () => {
  test("never exceeds its limit when a caller arrives right after a release", async () => {
    const semaphore = new Semaphore(1);
    let active = 0;
    let maxActive = 0;
    const task = async (): Promise<void> => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 1));
      active -= 1;
    };

    const release = await semaphore.acquire();
    const queued = semaphore.run(task); // waits for the held permit
    release();
    const lateArrival = semaphore.run(task); // arrives before the waiter has resumed
    await Promise.all([queued, lateArrival]);

    assert.strictEqual(maxActive, 1);
  });
});
