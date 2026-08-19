# TASK-0003 Design

> 状态：Approved
> Spec Revision：1

## 边界

新增 `src/domain/coding-task.ts`。它只依赖 Node Crypto 和既有领域错误，不依赖 Restate、文件系统、Git 或 Agent。创建函数负责运行时校验、规范化、深复制和冻结；私有 WeakSet 区分本进程内已验证实例，不信任可复制字段。序列化 Envelope、Attempt 与 Binding 必须通过 Parse API，结合调用方另外冻结的 Expected Digest 重建和校验。

## 数据关系

```text
TaskEnvelope(spec revision + digest)
  ├── Requirement[]
  ├── ValidationCommand[] (argv)
  ├── ContextPlan
  └── CodingStep[]
        └── Attempt generation 1..N
```

Step 是固定计划中的逻辑节点；Attempt 是一次实际执行。初始 Attempt ID 按 Step/Generation 确定生成，使同一调度命令可幂等重放；重试必须提交连续完整历史并创建下一 Generation，不修改旧 Attempt。运行中 Attempt 根据 Artifact Name 派生唯一 URI，并产生含 Content Digest 与 Producer Tuple 的 Evidence Record；成功 Attempt 才能生成 Binding，因此不存在接受裸 Artifact Ref 的重绑定入口。

## 稳定性

- Pipeline 顺序由代码常量定义，不接受请求自定义；
- Pipeline 常量、Envelope、Step、Attempt 和 Evidence Binding 都在运行时冻结；
- Digest 基于完整规范对象，不含创建时间等不确定字段；
- 数组顺序是 Spec 的一部分；重复稳定 ID 被拒绝；
- Validation Command 原样保存 argv，执行策略固定为 `shell: false`；可执行文件 Allowlist 留给 Verification Gate Policy；
- Spec 升版必须重新创建 Envelope，旧 Evidence 仍可审计但不能通过当前 Gate。

WeakSet 只提供进程内构造来源约束，不跨进程持久化，也不替代 Workflow 状态所有权。跨进程恢复依靠 Canonical Digest、Expected Digest 和 Parse 重建；Artifact 内容是否真实存在由后续 Artifact Store/Gate 校验。

Expected Digest 必须来自 Envelope 外部已冻结的 Event、Checkpoint 或 Artifact Metadata，禁止从待解析对象自身回填。不可变纯函数也不负责防止同一 RUNNING Snapshot 并发分叉提交两个终态；后续 Workflow 必须用 State Version/CAS 串行化提交。
