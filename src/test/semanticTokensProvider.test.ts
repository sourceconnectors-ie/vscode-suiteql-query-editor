import * as assert from "assert";
import { findIdentifierTokens } from "../completion/semanticTokensProvider.js";

suite("findIdentifierTokens", () => {
  test("tags a known table name as class", () => {
    const tokens = findIdentifierTokens(["select * from customer"], new Set(["customer"]), new Set());
    assert.deepStrictEqual(tokens, [{ line: 0, startChar: 14, length: 8, tokenType: "class" }]);
  });

  test("tags a known column name as property", () => {
    const tokens = findIdentifierTokens(["select entityid from customer"], new Set(["customer"]), new Set(["entityid"]));
    const propertyToken = tokens.find((t) => t.tokenType === "property");
    assert.deepStrictEqual(propertyToken, { line: 0, startChar: 7, length: 8, tokenType: "property" });
  });

  test("is case-insensitive", () => {
    const tokens = findIdentifierTokens(["SELECT * FROM Customer"], new Set(["customer"]), new Set());
    assert.strictEqual(tokens.length, 1);
    assert.strictEqual(tokens[0].tokenType, "class");
  });

  test("skips SQL keywords even if they happen to match nothing else", () => {
    const tokens = findIdentifierTokens(["select * from customer"], new Set(["customer"]), new Set());
    assert.ok(!tokens.some((t) => t.startChar === 0)); // "select" never tagged
  });

  test("skips an identifier with no known table or column match", () => {
    const tokens = findIdentifierTokens(["select unknown_col from customer"], new Set(["customer"]), new Set());
    assert.strictEqual(tokens.length, 1);
    assert.strictEqual(tokens[0].tokenType, "class");
  });

  test("does not match an identifier inside a string literal", () => {
    const tokens = findIdentifierTokens(["select * from account where name = 'customer service'"], new Set(["customer"]), new Set());
    assert.strictEqual(tokens.length, 0);
  });

  test("does not match an identifier inside a line comment", () => {
    const tokens = findIdentifierTokens(["-- select from customer later", "select * from account"], new Set(["customer"]), new Set());
    assert.strictEqual(tokens.length, 0);
  });

  test("prefers class over property when a name matches both", () => {
    const tokens = findIdentifierTokens(["select customer from account"], new Set(["customer"]), new Set(["customer"]));
    assert.strictEqual(tokens.length, 1);
    assert.strictEqual(tokens[0].tokenType, "class");
  });
});
