import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

describe("repository development profiles", () => {
  it("defines auto as a selector over lite, standard, and full in the repository contract", async () => {
    const contract = await readFile(new URL("../../AGENTS.md", import.meta.url), "utf8");

    expect(contract).toContain("## 0. 开发执行档位");
    expect(contract).toContain("`auto` 是默认选择器，不是第四个档位");
    expect(contract).toContain("### 0.1 Lite");
    expect(contract).toContain("### 0.2 Standard");
    expect(contract).toContain("### 0.3 Full");
    expect(contract).toContain("Lite 是显式的治理豁免");
    expect(contract).toContain("不能降级绕过门禁");
    expect(contract).toContain("`performance` 表示并行 Agent");
  });

  it("keeps the task-control skill aligned with Lite exemption and escalation", async () => {
    const skill = await readFile(new URL("../../.agents/skills/moye-task-control/SKILL.md", import.meta.url), "utf8");

    expect(skill).toContain("## Select the development profile");
    expect(skill).toContain("gates for Standard/Full work; Lite follows the explicit exemption below");
    expect(skill).toContain("### Lite");
    expect(skill).toContain("### Standard");
    expect(skill).toContain("### Full");
    expect(skill).toContain("Lite must not create lifecycle-only Finding, Backlog, Task package, Docs Impact, Document Graph, or Seal artifacts.");
    expect(skill).toContain("It must not invoke Context Route or a Runtime Workflow merely to manufacture process evidence.");
    expect(skill).toContain("If the scope crosses any Lite boundary");
  });
});
