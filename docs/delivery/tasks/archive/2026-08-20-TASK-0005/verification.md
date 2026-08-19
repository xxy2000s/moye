# TASK-0005 Verification

> 状态：Accepted
> Spec Revision：1
> 验证日期：2026-08-20
> 执行者：Goal `/root`（`GOAL_BOOTSTRAP`）

## 验收映射

| Requirement | 证据 | 结果 |
|---|---|---|
| REQ-0005-01 | Request 稳定摘要/JSON Roundtrip；Git top-level、Git metadata、filesystem root、symlink、Step/Attempt 边界失败测试 | 通过 |
| REQ-0005-02 | Fake success/failure/invalid script；相同 Run 复用同一 manifest；不完整 bundle 停止 | 通过 |
| REQ-0005-03 | 受控 ProcessRunner 精确断言 `codex exec --json --sandbox workspace-write --cd` argv；无 Shell、无 skip check | 通过 |
| REQ-0005-04 | 首事件/唯一 Session、最终 agent message、turn failed、非零 exit、时间/Duration 和 malformed JSONL 测试 | 通过 |
| REQ-0005-05 | 三类内容摘要、Producer/Run Digest、pending manifest 恢复、文件篡改和外部 Expected Digest 校验 | 通过 |

## 命令证据

- `npm run check`：通过；TypeScript、58/58 单元测试和 75 文档/129 关系图均通过。
- `npm run test:e2e`：通过；既有 3/3 真实 Restate 回归用例无退化。
- `codex exec --help`：本机 `codex-cli 0.146.0` 的 JSONL、sandbox、cd 参数与 Adapter 一致。
- 未执行真实 Codex 调用；按 Spec 留到 TASK-0006 的临时 Fixture Smoke Test。

## 当前限制

- Session ID 被记录但本 Task 不实现 Resume；Workflow 接入和恢复策略属于 TASK-0006/0007。
- Artifact 是本地受管目录；远程 Store 和跨 Daemon 传输不在本轮范围。
