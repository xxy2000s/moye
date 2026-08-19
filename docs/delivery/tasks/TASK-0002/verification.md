# TASK-0002 Verification

> 状态：Accepted
> Spec Revision：1
> 验证日期：2026-08-20
> 执行者：Goal `/root`（`GOAL_BOOTSTRAP`）
> Runtime Closure：本文件作为关闭前验收输入；实际 Invocation、Result Commit 和 Archive 结果由关闭时生成的 `bootstrap-runtime-evidence.json` 与 Projection 记录

## 验收映射

| Requirement | 证据 | 结果 |
| --- | --- | --- |
| REQ-0002-01 | `tests/unit/backlog-sync.test.ts` 严格字段、枚举、文件名与批次加载测试 | 通过 |
| REQ-0002-02 | 单元测试覆盖 Digest 幂等、更新、重复 ID；真实 Restate 测试覆盖无部分写入 | 通过 |
| REQ-0002-03 | 单元测试覆盖文档消失与 Runtime-only 记录的 `PRESERVE` | 通过 |
| REQ-0002-04 | CLI 真实调用 + HTTP `GET /api/board`，Ready/Triaged 可见、Converted 隐藏 | 通过 |
| REQ-0002-05 | TypeScript、36 个单元测试、3 个真实 Restate E2E、文档图门禁 | 通过 |
| REQ-0002-06 | Gate 的正负测试与顺序测试已通过；实际 Result Commit/Invocation/Archive 由 Runtime Closure 生成 | 关闭前通过 |

## 执行证据

- `npm run check`：通过；`tsc --noEmit`、36/36 单元测试、57 个文档/105 条关系图校验均成功。
- `npm run test:e2e`：通过；2 个测试文件、3 个用例，使用两个临时真实 Restate 1.7.4 容器。
- `git diff --check`：通过（提交前复验）。
- `ruby scripts/docs_graph.rb validate-impact --report docs/delivery/tasks/TASK-0002/docs-impact.yaml`：通过（提交前复验）。

## 失败与边界证据

- 非法枚举、未知字段、重复 ID 会在整批提交前失败；真实 Restate 重复 ID 调用后 Board 前后相同。
- 文档源与 Runtime 输入发生同 ID 冲突时，两个写入方向都拒绝静默接管。
- 同 Digest 重试保留原 `updatedAt` 且不写 Projection；源文件消失只报告 `preservedIds`。
- Bootstrap 证据只接受干净 Worktree 的当前 HEAD、首次引入时冻结的 Base、提交中的指定 Task Artifact 与完整 Docs Impact；请求不能指定仓库根目录。
- Persist 前在同一 Durable Step 重新校验；失败测试证明验证错误不会把 Task Manifest 写成 `closed`。
- Persist 的未知结果重放会核对并补全自身确定性输出；部分落盘后重试测试通过。
- Runtime 明确拒绝非 `GOAL_BOOTSTRAP` Kind；`task-artifact://TASK-0002/...` Resolver 覆盖 Archive fallback 与符号链接逃逸测试。

## Review

第一轮只读审查发现证据根目录可由请求控制、证据未绑定提交内容、先关闭后持久化、双向数据归属缺口和测试缺口。第二轮继续发现 Artifact 归档解析、冻结 Base、Dirty Worktree、Verify/Persist 间隙、模板兼容和证据测试缺口。第三轮又发现 Durable Replay 自身 Dirty、Runtime Kind 与符号链接逃逸；均已修复并补充回归测试。第四轮独立复核未发现 blocker 或 major，同意进入 Result Commit 与真实 Runtime Closure。

自举执行者为当前 Goal；Moye Runtime 只在能力和证据已存在后承担状态关闭与归档，不冒充 Agent 编码执行器。
