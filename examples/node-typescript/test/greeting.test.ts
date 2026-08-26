import assert from "node:assert/strict";
import test from "node:test";

import { greeting } from "../src/greeting.ts";

test("greets a normalized name", () => {
  assert.equal(greeting(" Moye "), "Hello, Moye!");
});

test("rejects an empty name", () => {
  assert.throws(() => greeting("  "), /name is required/);
});
