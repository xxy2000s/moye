import { describe, expect, it } from "vitest";

import { runCodexSessionProductAcceptance } from "../../scripts/codex_session_product_acceptance.js";

const productIt = process.env["MOYE_RUN_REAL_CODEX_SESSION_ACCEPTANCE"] === "1" ? it : it.skip;

describe("Codex native Session product acceptance", () => {
  productIt("runs a real Codex Role and captures its Provider-native rollout", async () => {
    const result = await runCodexSessionProductAcceptance();
    expect(result.taskId).toBe("TASK-0059");
    expect(result.sessionId).toMatch(/^[0-9a-f-]+$/u);
    expect(result.counts["PROMPT"]).toBe(1);
    expect(result.counts["ASSISTANT"]).toBeGreaterThan(0);
    expect(result.counts["TOOL_CALL"]).toBeGreaterThan(0);
    expect(result.counts["TOOL_RESULT"]).toBeGreaterThan(0);
  }, 180_000);
});
