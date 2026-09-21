import * as assert from "assert";
import { appendQuery, mapRcFieldToColumnInfo } from "../schemaCache/restletFieldMapping.js";

suite("restletFieldMapping", () => {
  suite("appendQuery", () => {
    test("appends params to a RESTlet URL that already has script/deploy params", () => {
      const url = appendQuery("https://acct.restlets.api.netsuite.com/app/site/hosting/restlet.nl?script=1&deploy=1", {
        mode: "table",
        table: "customer",
      });
      const parsed = new URL(url);
      assert.strictEqual(parsed.searchParams.get("script"), "1");
      assert.strictEqual(parsed.searchParams.get("deploy"), "1");
      assert.strictEqual(parsed.searchParams.get("mode"), "table");
      assert.strictEqual(parsed.searchParams.get("table"), "customer");
    });
  });

  suite("mapRcFieldToColumnInfo", () => {
    test("maps id/label to columnName/description, with dataType unknown when absent", () => {
      const column = mapRcFieldToColumnInfo({ id: "trandate", label: "Date" });
      assert.deepStrictEqual(column, {
        columnName: "trandate",
        dataType: "unknown",
        description: "Date",
        isRequired: undefined,
      });
    });

    test("uses a real type/mandatory flag when the field happens to carry one", () => {
      const column = mapRcFieldToColumnInfo({ id: "id", label: "Internal ID", type: "integer", mandatory: true });
      assert.strictEqual(column?.dataType, "integer");
      assert.strictEqual(column?.isRequired, true);
    });

    test("prefers dataType over type — a real getRecordTypeDetail response's `type` is always the catalog entry kind (\"RECORD_FIELD\"), never the field's actual data type", () => {
      const column = mapRcFieldToColumnInfo({ id: "availableBalance", label: "Available Balance", type: "RECORD_FIELD", dataType: "currency" });
      assert.strictEqual(column?.dataType, "currency");
    });

    test("falls back through type, then fieldType, then valueType, in that order, when dataType is absent", () => {
      assert.strictEqual(mapRcFieldToColumnInfo({ id: "a", type: "select" })?.dataType, "select");
      assert.strictEqual(mapRcFieldToColumnInfo({ id: "a", fieldType: "select" })?.dataType, "select");
      assert.strictEqual(mapRcFieldToColumnInfo({ id: "a", valueType: "STRING" })?.dataType, "STRING");
    });

    test("falls back to the RECORD_FIELD category marker itself when nothing more specific is present", () => {
      // Not ideal, but there's nothing better to show — matches suiteql-editor-tool-kit's own
      // fallback chain for the same data.
      assert.strictEqual(mapRcFieldToColumnInfo({ id: "a", type: "RECORD_FIELD" })?.dataType, "RECORD_FIELD");
    });

    test("returns undefined for a field with no string id", () => {
      assert.strictEqual(mapRcFieldToColumnInfo({ label: "no id" }), undefined);
      assert.strictEqual(mapRcFieldToColumnInfo("not an object"), undefined);
      assert.strictEqual(mapRcFieldToColumnInfo(null), undefined);
    });

    test("excludes a SUBLIST field (dataType N/A) instead of offering it as a queryable column", () => {
      // Confirmed against a live account: `SELECT bulkMerge FROM customer` fails with NetSuite's
      // own "UNSUITABLE - Unsupported return field type 'SUBLIST' for channel SEARCH" — dataType
      // "N/A" is Records Catalog's own marker for exactly this, so the column must not appear at
      // all, not just show an unhelpful/misleading type.
      assert.strictEqual(mapRcFieldToColumnInfo({ id: "bulkMerge", label: "Bulk Merge", dataType: "N/A" }), undefined);
      assert.strictEqual(mapRcFieldToColumnInfo({ id: "addressBook", label: "Address Book", dataType: "N/A" }), undefined);
    });
  });
});
