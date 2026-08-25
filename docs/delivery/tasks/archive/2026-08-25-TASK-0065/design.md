# TASK-0065 Design

> 状态：Approved

## 设计

新增只读聚合 Harness `scripts/agent_session_full_acceptance.ts`。它按固定顺序运行真实 Codex 与 Claude Adapter 产品验收，显式读取调用方给定的 Session Capture Recovery summary，针对其中精确 Task/Run 查询 Restate Board API，再执行指定历史 Task 的 append-only enrichment。最终报告只组合各来源的真实标识和 Digest，不写 Task 主状态。

Recovery 输入必须由 `MOYE_AGENT_SESSION_RECOVERY_SUMMARY` 指定。Harness 校验 summary 的 scenario、成功归档、七类 Role 与每个 COMPLETE Receipt；随后从 Board 的 `/trace` 和每个 Run 的 `/session|timeline|events|stderr` 重新验证。缺少或漂移均 fail closed，不扫描 `.moye-runtime` 寻找替代结果。

报告先生成不含自身摘要的 canonical JSON，再以命名空间摘要形成 `reportDigest`。默认写入显式 `MOYE_AGENT_SESSION_ACCEPTANCE_REPORT`；Task 验收时固定到归档包。浏览器验收独立保存截图和检查清单，避免浏览器像素结果冒充 Runtime Evidence。

本 Task 不新增状态机、Effect 或持久化协议；部署只注册当前构建的既有 Restate services，并保持 Board 只读。

