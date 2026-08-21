# TASK-0011 Verification

> 状态：Accepted
> 验证日期：2026-08-21
> Spec Revision：1

## 验收结论

TASK-0011 满足 Spec Revision 1：Moye 可以在隔离 Fixture 中选择 Fake、真实 Codex 或真实 Claude Runner；真实 CLI stdout 在执行期间按完整 JSONL 行持久化，并通过 Projection 中稳定的 Task/Attempt/Run locator 被看板持续读取。cursor API 与分类查看器可访问全部事件，不再只展示 4 条 Fake 摘要或永久截断前 200 条。

## 自动化证据

- `npm run check`：通过；TypeScript 类型检查、17 个单元测试文件共 96 项及文档图谱校验全部通过；
- `npm run test:e2e`：通过；4 个真实 Restate E2E 文件共 11 项通过；
- Agent unit 证明 JSONL 跨 chunk 尾部不会提前落成半行，进程仍运行时完整行已可读取，完成 Artifact 与最终 stdout 完全一致；
- Board unit 证明活动流按 cursor 分页并区分系统、工具调用、工具结果和错误，同时拒绝不匹配 Intent、越界根、symlink、大小或摘要漂移；
- Restate Coding E2E 使用 200 ms 延迟的受控 CODEX_EXEC 流：任务仍在 IMPLEMENT 时读取到未完成页面，结束后 6 条事件通过两个 cursor 页面完整返回，并继续完成 Verification、唯一 Merge 与 Archive；
- Demo E2E 证明 Fake 模式兼容、cursor API 和新前端契约可用。

## 真实 Codex CLI 验收

在本机 `codex-cli 0.146.0` 上执行：

```text
MOYE_DEMO_CONTAINER_NAME=moye-task0011-codex \
MOYE_DEMO_ROOT=/tmp/moye-task0011-codex-20260821 \
npm run demo:codex
```

隔离任务 `TASK-DEMO-MT2XZ0EC` 在 Agent 运行时先读取到 4 条、随后 13 条事件，完成后冻结 17 条原始 JSONL。事件包含 `thread.started`、Agent 消息、5 次工具调用、5 次工具结果、文件修改、`git commit` 与 `turn.completed`；Agent Session 为 `01a0245a-4e89-7ae1-a4fd-4159122821d6`。结果 Commit `cecb9e0fae…` 通过固定验证，并唯一合入 `5e0dac51a1…` 后归档。Runner 明确为 `CODEX_EXEC`，不是 Fake。

## 真实浏览器验收

使用 Playwright CLI 在 `http://127.0.0.1:50892` 验证真实 Codex Task：

1. 已归档 Task 显示 Codex CLI、Agent Session、Result/Merge 关联与闭环结论；
2. 点击 `查看 Agent Events` 后显示 `已加载 17 / 17 条 · 已完成`；
3. 分类计数为对话 3、工具调用 5、工具结果 5、系统/错误按事件结构归类；
4. 工具调用筛选只显示对应 5 条，展开后可见完整命令 JSON；
5. 390 × 844 viewport 下筛选、事件列表、原始 JSON 和下载入口仍可访问；
6. 浏览器控制台 0 error、0 warning。

## 权威与安全边界

- Workflow 仍是 Task 主状态唯一写入者；Agent Stream、Artifact、Trace 和 Viewer 都是只读诊断/交接证据；
- 活动事件只从 Projection locator 派生路径，并验证受管根、execution intent、regular file、realpath 与 16 MiB 上限；
- 完成事件继续通过 manifest 的 artifact ref、大小和 SHA-256 校验；
- Claude 只使用进程级 `--permission-mode acceptEdits` 与可选 OTel 环境，不修改用户级 Settings；未由 CLI 暴露的隐藏 HTTP 请求或隐藏推理不在采集范围。
