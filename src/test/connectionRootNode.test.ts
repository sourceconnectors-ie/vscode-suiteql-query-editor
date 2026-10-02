import * as assert from "assert";
import { ConnectionRootNode } from "../objectExplorer/nodes.js";

suite("ConnectionRootNode", () => {
  test("shows the realm for a normal connection", () => {
    const node = new ConnectionRootNode("a", "Prod", "1234567", true);
    assert.strictEqual(node.description, "1234567");
  });

  test("marks a connection with a server URL override as mock, so it can't pass for the real account", () => {
    const active = new ConnectionRootNode("a", "Local", "1234567_SB1", true, "http://127.0.0.1:8000");
    assert.strictEqual(active.description, "mock: http://127.0.0.1:8000");
    const inactive = new ConnectionRootNode("a", "Local", "1234567_SB1", false, "http://127.0.0.1:8000");
    assert.strictEqual(inactive.description, "mock: http://127.0.0.1:8000 · disconnected");
  });
});
