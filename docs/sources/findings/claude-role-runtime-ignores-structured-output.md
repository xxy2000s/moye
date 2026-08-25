# Claude Role Runtime 忽略 CLI 的 structured_output

> 文档类型：Finding
> 状态：Resolved
> 发现日期：2026-08-25
> 修复 Task：TASK-0060

`TASK-0060` 首次真实 Claude 产品验收中，Claude CLI 以退出码 0 返回了 `result.structured_output`，其中包含符合 Role Schema 的 `PASS` 结果；同时 `result.result` 是面向人的普通文本。`src/agent/role-runtime-v2.ts` 只读取后者并尝试 `JSON.parse`，因此把真实成功 Role Run 错误记录为 `INVALID_OUTPUT`。

失败证据保留在本机 Role Evidence Root `moye-task-0060-claude-product-MOjAu9`，对应 Session `42c3db66-ee9c-4048-9af1-58a2439b6c93`。修复后 Runtime 优先验证 Claude CLI 的结构化对象，仅在该字段不存在时兼容旧文本结果；E2E 固定“普通 result 文本 + 合法 structured_output”回归用例，真实 Claude Role Run 与原生 Session capture 随后通过。

该缺陷影响 Claude Role 结果解释，不改变 Task 主状态所有权、UNKNOWN/Reconcile 或 Provider Transcript Sidecar 边界。
