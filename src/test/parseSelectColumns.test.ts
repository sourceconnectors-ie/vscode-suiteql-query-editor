import * as assert from "assert";
import { parseSelectColumns, parseSelectColumnDetails } from "../resultsPane/parseSelectColumns.js";

suite("parseSelectColumns", () => {
  test("extracts aliased columns from a simple SELECT", () => {
    assert.deepStrictEqual(
      parseSelectColumns("SELECT id AS record_id, entityid AS name FROM customer"),
      ["record_id", "name"],
    );
  });

  test("extracts a bare table.column reference with no alias", () => {
    assert.deepStrictEqual(parseSelectColumns("SELECT customer.id, entityid FROM customer"), ["id", "entityid"]);
  });

  test("handles SELECT TOP n", () => {
    assert.deepStrictEqual(parseSelectColumns("SELECT TOP 10 id AS record_id FROM customer"), ["record_id"]);
  });

  test("handles SELECT DISTINCT", () => {
    assert.deepStrictEqual(parseSelectColumns("SELECT DISTINCT status AS status FROM activity"), ["status"]);
  });

  test("skips a function call with no alias — cannot know NetSuite's derived name", () => {
    assert.deepStrictEqual(parseSelectColumns("SELECT COUNT(*) FROM customer"), []);
  });

  test("skips a bare * — cannot know the expanded column list", () => {
    assert.deepStrictEqual(parseSelectColumns("SELECT * FROM customer"), []);
  });

  test("does not split on a comma inside a function call's arguments", () => {
    assert.deepStrictEqual(
      parseSelectColumns("SELECT TO_CHAR(trandate, 'YYYY-MM-DD') AS formatted_date FROM transaction"),
      ["formatted_date"],
    );
  });

  test("does not split on a comma inside a string literal", () => {
    assert.deepStrictEqual(
      parseSelectColumns("SELECT 'a, b' AS literal_col, id AS record_id FROM customer"),
      ["literal_col", "record_id"],
    );
  });

  test("does not treat FROM inside a string literal or a nested subquery's parens as the top-level FROM", () => {
    assert.deepStrictEqual(
      parseSelectColumns("SELECT id AS record_id, 'text with from in it' AS note FROM customer"),
      ["record_id", "note"],
    );
  });

  test("returns an empty list for a query with no top-level FROM", () => {
    assert.deepStrictEqual(parseSelectColumns("SELECT 1 + 1 AS total"), []);
  });

  test("de-duplicates a repeated alias, keeping first-seen order", () => {
    assert.deepStrictEqual(parseSelectColumns("SELECT id AS x, entityid AS x FROM customer"), ["x"]);
  });

  test("extracts every aliased column from a real multi-function, multi-line query, including ones with nested-comma function calls", () => {
    const query = `
      SELECT TOP 10
          BUILTIN_RESULT.TYPE_STRING(title) AS title,
          BUILTIN.DF(type) AS type,
          BUILTIN_RESULT.TYPE_DATE(startdate) AS start_date,
          BUILTIN_RESULT.TYPE_DATE(enddate) AS end_date,
          BUILTIN_RESULT.TYPE_STRING(TO_CHAR(starttime, 'YYYY-MM-DD HH24:MI:SS')) AS start_time,
          BUILTIN_RESULT.TYPE_STRING(TO_CHAR(endtime, 'YYYY-MM-DD HH24:MI:SS')) AS end_time,
          BUILTIN_RESULT.TYPE_STRING(remindertype) AS reminder_type,
          BUILTIN_RESULT.TYPE_INTEGER(company) AS company,
          BUILTIN.DF(company) AS company_name,
          timedevent AS timed_event,
          BUILTIN_RESULT.TYPE_INTEGER(relateditem) AS related_item,
          BUILTIN.DF(relateditem) AS related_item_name,
          BUILTIN_RESULT.TYPE_INTEGER(reminderminutes) AS reminder_minutes,
          BUILTIN_RESULT.TYPE_STRING(status) AS status,
          BUILTIN_RESULT.TYPE_DATE(completeddate) AS completed_date,
          BUILTIN_RESULT.TYPE_INTEGER(transaction) AS transaction,
          BUILTIN.DF(transaction) AS transaction_name,
          BUILTIN_RESULT.TYPE_STRING(TO_CHAR(lastmodifieddate, 'YYYY-MM-DD HH24:MI:SS')) AS orig_last_modified_date,
          BUILTIN_RESULT.TYPE_STRING(TO_CHAR(SYSDATE, 'YYYY-MM-DD HH24:MI:SS')) AS lastmodifieddate
      FROM
          activity
      WHERE
          1 = 1
    `;
    assert.deepStrictEqual(parseSelectColumns(query), [
      "title",
      "type",
      "start_date",
      "end_date",
      "start_time",
      "end_time",
      "reminder_type",
      "company",
      "company_name",
      "timed_event",
      "related_item",
      "related_item_name",
      "reminder_minutes",
      "status",
      "completed_date",
      "transaction",
      "transaction_name",
      "orig_last_modified_date",
      "lastmodifieddate",
    ]);
  });

  test("does not treat a column/alias whose name starts with a keyword as that keyword — 'fromage' is not FROM", () => {
    assert.deepStrictEqual(
      parseSelectColumns("SELECT fromage AS cheese FROM customer"),
      ["cheese"],
    );
  });

  test("does not treat a keyword immediately followed by an identifier character as a real keyword match", () => {
    // Nothing here should be mistaken for a top-level FROM before the real one.
    assert.deepStrictEqual(
      parseSelectColumns("SELECT id AS fromagerie FROM customer"),
      ["fromagerie"],
    );
  });

  test("treats $ as an identifier character, matching the parser's own IDENTIFIER definition", () => {
    assert.deepStrictEqual(parseSelectColumns("SELECT a$from AS x FROM customer"), ["x"]);
  });
});

suite("parseSelectColumnDetails", () => {
  test("resolves an aliased simple column reference back to its source column name", () => {
    assert.deepStrictEqual(parseSelectColumnDetails("SELECT entityid AS id FROM customer"), [
      { outputName: "id", sourceColumnName: "entityid" },
    ]);
  });

  test("resolves an aliased table.column reference back to just the column part", () => {
    assert.deepStrictEqual(parseSelectColumnDetails("SELECT customer.entityid AS id FROM customer"), [
      { outputName: "id", sourceColumnName: "entityid" },
    ]);
  });

  test("an unaliased simple reference has sourceColumnName equal to outputName", () => {
    assert.deepStrictEqual(parseSelectColumnDetails("SELECT entityid FROM customer"), [
      { outputName: "entityid", sourceColumnName: "entityid" },
    ]);
  });

  test("an aliased function call/expression has an undefined sourceColumnName", () => {
    assert.deepStrictEqual(parseSelectColumnDetails("SELECT COUNT(*) AS total FROM customer"), [
      { outputName: "total", sourceColumnName: undefined },
    ]);
  });

  test("returns undefined for a SELECT * query", () => {
    assert.strictEqual(parseSelectColumnDetails("SELECT * FROM customer"), undefined);
  });

  test("returns undefined for a table.* query", () => {
    assert.strictEqual(parseSelectColumnDetails("SELECT customer.* FROM customer"), undefined);
  });

  test("returns undefined for a query with no top-level FROM", () => {
    assert.strictEqual(parseSelectColumnDetails("SELECT 1 + 1 AS total"), undefined);
  });
});
