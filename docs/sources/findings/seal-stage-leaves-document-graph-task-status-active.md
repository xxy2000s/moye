# Seal Stage 后文档图仍把 Task 标成 Active

> 文档类型：Finding
> 状态：Confirmed
> 发现日期：2026-08-24
> 影响范围：Sealed Task、Document Graph、Context Route

## 观察

TASK-0046 完成 `seal-stage` 后，Task Package 已从 Active 路径移动到 `archive/`，但 `docs/graph.yaml` 中六个 Task Artifact 节点仍为 `status: active`，索引关系仍从 `tasks-index` 指向 Task。Seal Gate 会验证路径与 Docs Impact，却不会自动修正这组当前文档图语义。

## 影响

- 后续 Context Route 可能把已归档 Task 当成活动输入；
- Git Archive Index 与文档图状态不一致；
- 操作者必须依赖隐含手工步骤，容易重复遗漏。

## 边界

Runtime 的 `CLOSED / ARCHIVED` 事实和 TASK-0046 Result Commit 没有被改写。本 Finding 只描述当前文档控制面的状态漂移，不重写已封存 Task Package。

后续工作进入 [BL-0051](../../delivery/backlog/BL-0051.yaml)，由 TASK-0047 修复当前图谱并让 Evidence Audit 检查 Archive 路径/状态一致性。
