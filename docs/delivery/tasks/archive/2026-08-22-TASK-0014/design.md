# TASK-0014 Design

## 模块边界

新增 `src/agent/role-runner.ts`，复用现有 AgentRunner 的安全原则但不修改既有 Coding Runner 契约：

```text
Core PendingRoleDispatch
       │ create RoleAttempt / RoleRunRequest
       ▼
RoleAgentRunner (shared shell)
       │
       ├── DOCS           → DocsRoleOutput
       ├── IMPLEMENTATION → ImplementationRoleOutput + Self Review
       └── REVIEW         → ReviewRoleOutput
       │
       ▼
content-addressed Artifact Manifest + RoleRunResult
```

现有 `src/agent/runner.ts` 继续服务固定 Coding Workflow；后续 Core Workflow 的真实 Adapter 可以把统一 Role Request 映射到 Codex/Claude 进程，并按 Role 配置只读或可写权限。本 Task 先用确定性 Fake Role Runner 验证协议、恢复和 Schema，不声称真实 Review Sandbox 已实现。

## Attempt

- `RoleAttempt` 由 TASK-0013 的 `PendingRoleDispatch` 创建，Attempt ID 使用 `<task>/<ROLE-STEP>/attempt-NNN`；
- `SCHEDULED → RUNNING → SUCCEEDED | FAILED | CANCELLED` 单向推进；
- Retry 必须携带完整、连续且全终态历史，生成 Generation N+1；
- Result 的 Producer Tuple 固定 Task、Spec、Role、Step、Attempt、Generation、Run ID 和 Input Digest。

## Artifact 与恢复

- Artifact Root 和单 Run 目录必须是受管直接子级，拒绝文件系统根和符号链接逃逸；
- `execution-intent.json` 使用 `wx` 稳定写入；
- Fake 执行只在首次成功 Claim 后计数；已存在完整 Manifest 直接 Parse；
- 只有 Intent 而无 Manifest 时视为未知结果，不根据“Fake 应该安全”绕过生产语义；
- Result Manifest 固定每个文件的 SHA-256 与字节数，解析时重算。

## 输出契约

- Docs/`SPEC_DESIGN`：`spec`、`plan`、`design`；
- Docs/`DOCS_IMPACT`：`docs_impact`、`knowledge_sync`；
- Implementation：`checkpoint`、`tests`、`self_review`；
- Review：`review_result`，`FINDINGS` 时允许额外 `finding` Artifact；
- 不同角色的 Artifact Kind 不能互相冒充。
