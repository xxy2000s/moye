# TASK-0003 Spec：最小编码任务协议

> 状态：Approved for bootstrap execution
> Spec Revision：1
> Backlog：BL-0002

## 目标

定义不依赖 Restate、Git Worktree 或 Agent 的纯领域协议，使后续执行层能消费一个不可变、可校验、可摘要的 TaskEnvelope，并将逻辑 Step 与每次 Attempt 分开追踪。

## Requirements

### REQ-0003-01：不可变 TaskEnvelope

- 固定 `task_id`、`spec_revision`、完整 `base_sha`、Requirements、验证命令和 Context Plan；
- 创建时深复制、深冻结，调用方后续修改输入不得改变 Envelope；
- 计算确定性的 SHA-256 Envelope Digest。

### REQ-0003-02：Requirement 与验证命令

- Requirement ID 在 Envelope 内唯一且格式稳定；
- 验证命令必须是非空 argv，并固定执行策略为 `shell: false`；协议层不使用可绕过的 Shell 名称黑名单，具体可执行文件 Allowlist 由后续 Gate Policy 决定；
- Command ID 唯一，参数保留原始边界和内容，包括空参数与有意义的空白。

### REQ-0003-03：Context Plan

- 记录文档图版本、Intent、Required Read 与 Required Review；
- 空 Intent、非法图版本和重复文档 ID 必须拒绝；
- Context Plan 是 Envelope Digest 的组成部分。

### REQ-0003-04：固定 Pipeline 与 Step

- Pipeline 固定为 `CONTEXT → WORKSPACE → IMPLEMENT → VERIFY → MERGE → DOCS`；
- Step 绑定 Task ID、Spec Revision、Envelope Digest、顺序和依赖；
- 本 Task 只定义协议，不执行任何 Step。

### REQ-0003-05：独立 Attempt

- Attempt 是 Step 的一次执行，拥有独立 Attempt ID、Generation、状态和时间；
- 终态 Attempt 不得复活；重试必须创建更高 Generation 的新 Attempt；
- 初始 Attempt 构造是确定且幂等的；Retry 构造必须消费从 Generation 1 开始连续、有序、全部终态的完整历史；
- Attempt 与创建它的 Spec Revision 和 Envelope Digest 绑定。

### REQ-0003-06：证据失效

- Evidence Binding 必须同时匹配 Task ID、Spec Revision 和 Envelope Digest；
- Artifact Evidence 由运行中 Attempt 产生，URI 包含派生 Attempt ID，并固定 Artifact Name、Content Digest 和完整 Producer Tuple；
- Attempt、Evidence Record 与 Binding 各自带 Canonical Digest；Binding 只能从当前 Envelope 内一个可信的 `SUCCEEDED` Attempt 产生，不能把裸 Artifact Ref 重新贴到新 Revision；
- Spec Revision 或 Envelope 内容变化后，旧 Evidence 必须判定失效；
- 失效只表示不能用于当前 Gate，不删除历史证据。
- JSON/Restate 反序列化必须携带外部已冻结的 Expected Digest 并通过重建校验，不能信任对象自报摘要。

## 非目标

- 不创建或管理 Git Worktree；
- 不执行命令或 Agent；
- 不接入 Restate Workflow；
- 不实现 Lease、Fencing、Retry Budget、Repair 或 Replan；
- 不改变现有 TaskWorkflow 主状态机。

## 完成定义

纯领域单元测试证明 Envelope 不可变、摘要确定、Pipeline 固定、Attempt 独立且不可复活，并证明 Spec Revision 变化会让旧证据失效；TypeScript 和文档门禁通过。
