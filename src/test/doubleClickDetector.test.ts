import * as assert from "assert";
import { DoubleClickDetector } from "../objectExplorer/doubleClickDetector.js";

function withClock(...timestamps: number[]) {
  let index = 0;
  return () => timestamps[index++];
}

suite("DoubleClickDetector", () => {
  test("two clicks on the same item within the threshold is a double click", () => {
    const detector = new DoubleClickDetector<string>(500, withClock(0, 300));
    assert.strictEqual(detector.registerClick("account"), false);
    assert.strictEqual(detector.registerClick("account"), true);
  });

  test("a single click is never a double click", () => {
    const detector = new DoubleClickDetector<string>(500, withClock(0));
    assert.strictEqual(detector.registerClick("account"), false);
  });

  test("two clicks on different items is never a double click", () => {
    const detector = new DoubleClickDetector<string>(500, withClock(0, 100));
    assert.strictEqual(detector.registerClick("account"), false);
    assert.strictEqual(detector.registerClick("customer"), false);
  });

  test("two clicks on the same item past the threshold is not a double click", () => {
    const detector = new DoubleClickDetector<string>(500, withClock(0, 600));
    assert.strictEqual(detector.registerClick("account"), false);
    assert.strictEqual(detector.registerClick("account"), false);
  });

  test("a detected double click resets — a third rapid click starts a fresh pair", () => {
    const detector = new DoubleClickDetector<string>(500, withClock(0, 100, 150));
    assert.strictEqual(detector.registerClick("account"), false);
    assert.strictEqual(detector.registerClick("account"), true);
    assert.strictEqual(detector.registerClick("account"), false);
  });

  test("object identity, not equality, decides sameness", () => {
    const a = { id: "account" };
    const b = { id: "account" };
    const detector = new DoubleClickDetector<{ id: string }>(500, withClock(0, 100));
    assert.strictEqual(detector.registerClick(a), false);
    assert.strictEqual(detector.registerClick(b), false);
  });
});
