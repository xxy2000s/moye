# TASK-0003 Design

> 状态：Approved
> Spec Revision：1

## 边界

新增 `src/domain/coding-task.ts`。它只依赖 Node Crypto 和既有领域错误，不依赖 Restate、文件系统、Git 或 Agent。创建函数负责运行时校验、规范化、深复制和冻结，消费者不能直接构造可信 Envelope。

## 数据关系

```text
TaskEnvelope(spec revision + digest)
  ├── Requirement[]
  ├── ValidationCommand[] (argv)
  ├── ContextPlan
  └── CodingStep[]
        └── Attempt generation 1..N
```

Step 是固定计划中的逻辑节点；Attempt 是一次实际执行。Step 重试不修改旧 Attempt，而是创建下一 Generation。Evidence Binding 是 Gate 输入索引，不拥有或删除 Artifact。

## 稳定性

- Pipeline 顺序由代码常量定义，不接受请求自定义；
- Digest 基于完整规范对象，不含创建时间等不确定字段；
- 数组顺序是 Spec 的一部分；重复稳定 ID 被拒绝；
- Spec 升版必须重新创建 Envelope，旧 Evidence 仍可审计但不能通过当前 Gate。
