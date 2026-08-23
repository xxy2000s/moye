# Findings：Bug、缺陷与异常发现

Finding 记录一个已经观察到、但尚未进入 Task 执行生命周期的问题。它可以来自开发、测试、Agent 运行或真实环境。

Finding 与 Incident 的边界：

- Finding 描述一个可独立确认和修复的问题；
- Incident 描述一次有时间线、影响和处置过程的故障事件；
- 一个 Incident 可以产生多个 Finding；
- 一个 Finding 经过去重和初步确认后可以生成 Backlog Item。

## 当前 Finding

- [Backlog 文档未投影到项目看板](./backlog-docs-not-projected.md)：Git 中的 Backlog YAML 与 Restate ProjectBoard Projection 尚无显式同步路径。
- [Demo 未展示编码任务与 Agent Trace](./demo-does-not-show-coding-agent-trace.md)：一键 Demo 仍使用通用 TaskWorkflow，无法体验已经实现的 Coding Trace。
- [CLI close 未按契约附着既有 Workflow](./cli-close-does-not-attach.md)：`create` 后调用 `close` 会重复调用 Workflow `run` 并收到 409，尽管同一 Workflow 已正常收束。
- [页面没有展示 Task 的真实状态机](./task-state-machine-not-visible.md)：静态阶段条和最终字段没有展示合法边、实际转换、Repair Attempt 与独立 Archive 历史。
- [多角色 Session Events 链接绕过弹窗](./session-events-links-bypass-viewer.md)：角色明细仍用新页面打开原始 Event API，绕过已有独立 Viewer 与分类筛选。
- [状态机节点下钻缺少执行与管控细节](./state-machine-node-details-shallow.md)：节点 Inspector 只显示计数和摘要，无法直接核对 Agent、Attempt、系统 Gate 与 Session Events。
- [节点 Agent Events 入口隐蔽且 Inspector 信息过密](./node-agent-events-hidden-and-inspector-dense.md)：真实 Agent Events 被埋在执行卡片底部，Domain Event 与 Agent Event 缺少清晰边界，节点详情难以扫描。
- [状态机边标签与合法路径详情可读性不足](./state-machine-edge-labels-and-legal-path-detail-dense.md)：未经过合法边的完整说明以小字铺在画布上，节点合法路径仍使用拥挤的旧式双卡片布局。
- [单任务弹窗与原始 Domain Event 难以持续审计](./task-detail-dialog-and-domain-events-hard-to-audit.md)：任务没有独立 URL，原始业务事件展开后也缺少稳定的时间线层级。
- [Core v2 失败终态没有完成 Closure 与 Archive](./core-v2-failed-terminal-does-not-close-or-archive.md)：失败 Workflow 只停在 `FAILED_TERMINAL`，LIVE-001～004 因而长期未归档。
- [Core v2 真实 Agent 故障矩阵证据不完整](./core-v2-real-fault-matrix-evidence-incomplete.md)：真实证据只完整覆盖 Happy Path，异常分支尚未达到同等级产品验收。
- [Core v2 Test Assessment Finding 会以 Invalid Output 绕过 Repair](./core-v2-test-assessment-finding-can-bypass-repair.md)：真实失败测试在形成 Test Report 前被 Output Gate 终止，尚未进入预期 Repair。
- [Sealed Recovery Attempt 无法从已失败 Attempt 继续追加](./sealed-recovery-attempt-cannot-chain.md)：真实 TASK-0040 recovery 暴露 numbered successor 只能读取第一层 recovery，无法形成任意长度 append-only chain。
- [Core v2 Role scope 遇到符号链接路径后在 Activity 重试](./core-v2-role-scope-symlink-path-retry-loop.md)：真实 Merge 验收 Task 在 claim 后才拒绝 `/tmp` 非 canonical 路径，需由同一 Journal 在新部署接管。
- [Core v2 共享 Failure Artifact Root 导致跨 Task 冲突](./core-v2-shared-failure-artifact-root-collides.md)：多个真实 Task 共用 Artifact Root 时，旧布局会竞争同一个 Failure 文件。
- [Trusted Test 文件摘要没有绑定落盘 Evidence 原始字节](./trusted-test-file-digest-does-not-bind-evidence-bytes.md)：Final Reviewer 发现 stdout/stderr Manifest Digest 与文件原始 SHA-256 不一致。
- [Core v2 durable command 失败后缺少合法 successor recovery](./core-v2-durable-command-failure-needs-successor-recovery.md)：journaled command failure 可能绕过 Workflow catch，原任务需要窄化 append-only recovery 收敛。
- [Core v2 成功路径没有 Archive Receipt](./core-v2-success-archive-receipt-missing.md)：成功 Task 当前从 CLOSED 直接投影 ARCHIVED，尚未执行真实 Success Archive Effect。
- [BL-0043 使用了不存在的 in_progress 状态](./bl-0043-uses-invalid-in-progress-status.md)：Backlog 同步门禁正确拒绝 Runtime 风格状态，已改为 SCHEDULED。
- [Core v2 历史 Recovery Projection 导致 Trace 详情返回 500](./core-v2-legacy-recovery-trace-nullability.md)：旧 schema 缺失 nullable 字段时只读状态机投影错误解引用，已由 TASK-0042 纳入兼容修复。

不要为了演示目录创建虚构 Bug。
