# Incidents：故障事件与后续输入

本目录只记录真实发生的开发、测试或生产故障。Incident 是带有时间线、影响和处置过程的故障事件，不是通用“证据”目录，也不等同于一个 Bug。

## 命名

```text
YYYY-MM-DD-short-title.md
```

## 流程

1. 从 [template.md](./template.md) 创建 Incident；
2. 记录事实时间线，不推测未验证原因；
3. 确定影响、根因和修复；
4. 将 Bug 或改进项拆成一个或多个 Finding / Backlog Item；
5. 将普遍教训提炼到 Pitfalls；
6. 如改变架构或技术选择，创建 ADR；
7. 更新本索引和 `docs/graph.yaml`，关联 Backlog、受影响的 Architecture、Pitfall 和 Runbook。

不要为了演示文档体系创建虚构 Incident。

## 已记录 Incident

- [本地 Restate 容器重建后 Board 历史投影丢失](./2026-08-22-restate-board-projection-lost-after-container-recreate.md)：Git Task Archive 未丢失，但未持久化的 Restate Journal 与 ProjectBoard Projection 随旧容器消失。
- [Bootstrap 基线门禁失败后 Projection 停留在 EXECUTING](./2026-08-22-bootstrap-base-commit-gate-left-projection-executing.md)：关闭门禁正确拒绝事后修正的错误基线，但 owning Invocation 失败后业务 Projection 未收敛为终态。
- [TASK-0032 提交错误 Seal Result Commit Evidence](./2026-08-23-wrong-seal-result-commit-evidence.md)：Gate 正确拒绝不存在的 Commit；原失败历史保留，通过 append-only successor 恢复。
- [TASK-0040 Docs Impact 漏项导致 Seal 失败](./2026-08-23-task-0040-docs-impact-seal-failure.md)：全部 Gate 拒绝和 successor 保留，TASK-0040/TASK-0040R1 最终通过多级 append-only recovery 收敛为 `SUCCEEDED + ARCHIVED`。
- [Core v2 真实 Merge 验收连续暴露 durable command 收敛缺口](./2026-08-23-core-v2-real-merge-acceptance-exposed-recovery-gaps.md)：五个独立真实 Task 保留失败链，第五个完成唯一 Merge UNKNOWN 对账，遗留恢复与成功 Archive 进入 Backlog。
- [Core v2 全矩阵首轮因 Restate OOM 暴露 Role 回执未知](./2026-08-23-core-v2-matrix-restate-oom-and-role-result-unknown.md)：首个新 Happy Task 保留为失败归档历史，并推动 Role UNKNOWN 正式进入业务对账状态。
- [TASK-0042 Verification 状态格式导致 Seal 失败](./2026-08-23-task-0042-verification-status-seal-failure.md)：机器字段附加说明导致 Gate 拒绝，原失败保留并由 TASK-0042R1 append-only 恢复。
- [TASK-0049 在 Active package 落盘前启动 Seal](./2026-08-24-task-0049-seal-start-before-package.md)：原 Invocation 在首个 durable command 失败且未创建业务 Projection；保留失败历史，由新 Task 增加派发前 preflight。
- [TASK-0058 Verification 状态导致 Seal 失败](./2026-08-25-task-0058-verification-status-seal-failure.md)：非规范机器状态通过 stage 后被最终 Gate 拒绝，由 TASK-0058R1 前移预检并 append-only 恢复。
- [TASK-0075 Seal 提交到非 canonical Restate Runtime](./2026-08-26-ga-seal-submitted-to-stale-runtime.md)：保留两个 Runtime 的真实历史，原 Task 与 canonical handoff 使用不同 Workflow key 并绑定同一 W10 Result Commit。
- [TASK-0077 Seal 首次提交到已遗留的非 canonical Runtime](./2026-08-27-task-0077-seal-submitted-to-stale-runtime.md)：同类故障复发；清理无引用 Service、停止但保留旧 Runtime，并用相同 Intent 等待同一 Result Commit 双端合法收敛。
