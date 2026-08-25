import { describe, expect, it } from "vitest";

import { runClaudeSessionProductAcceptance } from "../../scripts/claude_session_product_acceptance.js";

const productIt = process.env["MOYE_RUN_REAL_CLAUDE_SESSION_ACCEPTANCE"] === "1" ? it : it.skip;

describe("Claude native Session product acceptance", () => {
  productIt("runs a real Claude Role and captures its Provider-native session", async () => {
    const result = await runClaudeSessionProductAcceptance();
    expect(result.taskId).toBe("TASK-0060");
    expect(result.sessionId).toMatch(/^[0-9a-f-]+$/u);
    expect(result.counts["PROMPT"]).toBe(1);
    expect(result.counts["ASSISTANT"]).toBeGreaterThan(0);
    expect(result.counts["TOOL_CALL"]).toBeGreaterThan(0);
    expect(result.counts["TOOL_RESULT"]).toBeGreaterThan(0);
  }, 180_000);
});
