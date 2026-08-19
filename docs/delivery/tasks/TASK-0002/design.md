# TASK-0002 Design

> 状态：Approved  
> Spec Revision：1

## 边界

新增 `src/backlog/document-sync.ts` 负责 YAML 读取、严格转换与批次校验。它不依赖 Restate。ProjectBoard 新增批次 Handler，在一个 keyed Object Invocation 中执行 Merge；CLI 只负责加载文档并提交批次。

```text
BL-*.yaml
  → Document Backlog Loader
  → BacklogProjection[]
  → ProjectBoard.syncBacklog（单次调用）
  → GET /api/board
```

## 幂等策略

- Git Backlog 是导入字段的所有者；当前 PoC 不允许 Runtime 独立改写导入条目的生命周期字段；
- 每个导入条目携带规范化内容摘要；摘要相同时保留原 `updatedAt`；
- ProjectBoard 比较 Source Digest 和规范化记录，只有新增或字段变化时才 `ctx.set`；
- `PRESERVE` 保留运行时独有记录并显式返回 ID；
- 转换和重复 ID 检查在调用 Restate 前完成，避免坏条目造成部分提交。

ProjectBoard 是单个 keyed Object，批次 Handler 内的状态读取和 `ctx.set` 由 Restate 串行化。网络中断后调用者以同一规范化内容重试并按 Digest 收敛；这里不宣称跨 Object 事务。

## Bootstrap 关闭

现有 Goal 是真实执行者。TaskWorkflow 增加窄化的 Bootstrap Evidence 输入，记录执行者、结果 Commit 和证据引用后再关闭；它不调用模拟昂贵步骤，也不宣称 Agent 完成了编码。关闭后仍调用独立 ArchiveWorkflow。

## 依赖

使用 `yaml` 包解析 YAML，避免维护不完整的自制 YAML Parser。该依赖只进入文档 Adapter，不改变 Runtime 选型或领域状态所有权。
