# TASK-0056 Verification

> 状态：Accepted

## Requirement → Evidence

| Requirement | 验证 | 结果 |
|---|---|---|
| REQ-0056-01 | AGENTS 与 Skill 均把 `auto` 定义为选择器、把 `lite / standard / full` 定义为规范档位 | 通过 |
| REQ-0056-02 | AGENTS Lite 白名单与 Skill Lite procedure 明确免除 Route、生命周期文档、Graph 和 Seal | 通过 |
| REQ-0056-03 | Lite 完成标准固定 worktree 保护、直接源码、定向验证、视觉浏览器检查、`git diff --check` 和结果报告 | 通过 |
| REQ-0056-04 | Standard 固定最小 Task、Context Route、Docs Impact、相关测试和单 Result Commit，不强制多 Agent/故障矩阵 | 通过 |
| REQ-0056-05 | Full 触发器覆盖 Core/Runtime/Schema/Event/Artifact/Effect/Reconcile/Git/安全/迁移/依赖/架构/生产发布 | 通过 |
| REQ-0056-06 | AGENTS 与 Skill 均要求开始声明档位、风险扩大时只允许升级、用户不能降级绕过门禁 | 通过 |
| REQ-0056-07 | 契约明确 `performance` 正交、`ultimate` 非枚举；静态契约测试覆盖 AGENTS 与 Skill 一致性 | 通过 |

## 自动化证据

- `npx vitest run tests/unit/repository-development-profiles.test.ts`：1 个文件、2 个测试通过；
- `npm run check`：typecheck、40 个测试文件 / 227 个测试、Document Graph 全通过；
- `ruby scripts/docs_graph.rb validate-impact --report ...`：通过；
- `git diff --check`：通过。

## 验证边界

本任务只改变仓库 Agent 的开发治理协议，不增加 CLI 参数、Runtime Projection、Workflow 状态或 Board UI。`npm run test:e2e` 不涉及 Markdown/Skill 解释行为，因此不作为本次必要门禁；Runtime 的既有 Seal 只用于按旧规则封存这次治理迁移。
