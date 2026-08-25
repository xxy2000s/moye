# Architecture Decision Records

ADR 记录对架构产生长期影响的决策及其背景、候选方案和后果。

## 状态

- `Proposed`：等待评审；
- `Accepted`：当前有效；
- `Rejected`：评审后未采用；
- `Superseded`：已被新 ADR 替代；
- `Deprecated`：决定仍有历史意义，但不应继续采用。

Accepted ADR 不重写历史论证。改变决策时创建新 ADR，并在两份文档中建立 supersede 链接。

## 索引

| ADR | 状态 | 决策 |
|---|---|---|
| [0001](./0001-use-restate-for-task-runtime-poc.md) | Accepted | 使用 Restate 开展首个 Task Runtime PoC |
| [0002](./0002-organize-docs-by-lifecycle-role.md) | Accepted | 按 Sources、Delivery、Knowledge、Meta 组织文档 |
| [0003](./0003-use-typescript-for-restate-poc.md) | Accepted | 首个 Restate PoC 使用 TypeScript |
| [0004](./0004-use-otlp-contract-and-optional-phoenix.md) | Accepted | 使用 OTLP 契约与可选 Phoenix 作为轻量 Trace Demo |
| [0005](./0005-adopt-core-v2-five-plus-one-agent-model.md) | Accepted | 采用五个主流程 Agent 加一个非阻塞旁路 Agent |
| [0006](./0006-use-two-phase-sealed-result-commit.md) | Accepted | 使用两阶段 Sealed Result Commit 关闭仓库 Task |
| [0007](./0007-use-sidecar-session-transcript-evidence.md) | Accepted | 使用单向 Sidecar 保存 Agent Prompt 与 Provider Session 证据 |

## 新建 ADR

复制 [template.md](./template.md)，使用下一个四位编号，并同步更新本索引和 `docs/graph.yaml`，同时建立 `informs`、`governs` 或 `supersedes` 等关系。
