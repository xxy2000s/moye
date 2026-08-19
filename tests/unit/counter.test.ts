import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { incrementEffectCounter } from "../../src/effects/counter.js";

describe("idempotent effect counter", () => {
  it("counts one operation once across repeated delivery", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "moye-counter-test-"));
    const counterPath = path.join(root, "counter.txt");

    expect(await incrementEffectCounter(counterPath, "TASK-ONE")).toBe(1);
    expect(await incrementEffectCounter(counterPath, "TASK-ONE")).toBe(1);
    expect(await incrementEffectCounter(counterPath, "TASK-TWO")).toBe(2);
  });
});
