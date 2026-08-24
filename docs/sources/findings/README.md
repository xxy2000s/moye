# Findings：Bug、缺陷与异常发现

Finding 记录一个已经观察到、但尚未进入 Task 执行生命周期的问题。它可以来自开发、测试、Agent 运行或真实环境。

Finding 与 Incident 的边界：

- Finding 描述一个可独立确认和修复的问题；
- Incident 描述一次有时间线、影响和处置过程的故障事件；
- 一个 Incident 可以产生多个 Finding；
- 一个 Finding 经过去重和初步确认后可以生成 Backlog Item。

## 当前 Finding

- [Core v2 Recovery / Exception 分区仍占据大块空白](./core-v2-recovery-lane-remains-oversized.md)：TASK-0050 缩短了画布，但黄色异常背景仍横跨大半画布。
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
- [Core v2 Repair 后旧 Generation Evidence 缺少显式失效账本](./core-v2-repair-evidence-not-explicitly-invalidated.md)：旧 Artifact 文件仍在但 Projection 无法枚举所有 Trusted Test 并解释旧 Generation 失效关系，由 TASK-0043 修复。
- [Core v2 Design Reviewer 把未来阶段尚未发生误判为 Finding](./core-v2-design-review-crosses-phase-boundary.md)：真实 Reviewer 在 Implementation 前因 Candidate/测试尚不存在触发错误 REPLAN，由 TASK-0043 收紧 Phase 边界并保留失败历史。
- [Core v2 Observer 拒绝已失效 Revision 的合法历史 Attempt](./core-v2-observer-rejects-invalidated-revision-attempts.md)：真实失败归档 Task 因 Observer 只接受当前 Revision 而 Trace 500，由 TASK-0043 放行显式 invalidated Revision。
- [Core v2 Documentation Agent 提前消费 Trusted Test Gate](./core-v2-documentation-agent-consumes-test-gate.md)：真实 Test Failure 场景在 Trusted Runner 前被 Docs Agent 自行运行测试并提前 Repair，由 TASK-0043 收紧验收 Phase ownership。
- [Core v2 Fault Acceptance 默认场景选择被错误拒绝](./core-v2-acceptance-faults-default-selection-rejected.md)：未设置场景过滤器时全量入口被错误拒绝，由 TASK-0043 修复并用未筛选命令复验。
- [Core v2 Recovery Acceptance 生成了非法 Task ID](./core-v2-recovery-acceptance-generated-invalid-task-id.md)：完整场景名导致首个真实恢复调用违反 Task ID 领域约束，由 TASK-0044 改为提交前校验的短场景码。
- [Core v2 Recovery Acceptance 清理 Service 时可能不返回](./core-v2-recovery-acceptance-service-stop-race.md)：矩阵业务完成后 SIGTERM 和 exit listener 存在竞态，由 TASK-0044 改为精确 Child PID 的有界清理。
- [Core v2 Recovery Fixture 污染了真实 Agent Verdict](./core-v2-recovery-fixture-contaminates-agent-verdict.md)：仓库外测试 ledger 与可歧义标点触发非目标 Repair/Final Review Finding，由 TASK-0044 隔离 Agent 自测和 Trusted Runner 计数并收紧精确验收内容。
- [Core v2 Workflow 未实际执行智能 Observer/Knowledge](./core-v2-workflow-omits-intelligent-observer-execution.md)：Role 协议已有旁路角色但产品 Workflow 只写 `none`，由 TASK-0045 接入真实可超时且非阻塞的只读 Agent。
- [Core v2 Board 混淆 Runtime Outcome、归档处置与验收历史](./core-v2-board-obscures-runtime-outcome-and-acceptance-history.md)：Core 运行态被通用 Projection 压缩，缺少 Workflow/历史筛选和最新成功入口，由 TASK-0046 修复。
- [Seal Stage 后文档图仍把 Task 标成 Active](./seal-stage-leaves-document-graph-task-status-active.md)：Task Package 已归档但 Document Graph status/index relation 未同步，由 TASK-0047 纳入一致性审计。
- [Core v2 Role Intent-only 没有投影为 WAITING_RECONCILE](./core-v2-role-intent-only-not-projected-for-reconcile.md)：真实 OOM 中断后底层正确拒绝盲重试，但 Workflow/Board 缺少 Role 级业务对账状态，由 TASK-0048 修复。
- [Core v2 Reconcile 验收把不同时点 Projection 相等误当成幂等](./core-v2-reconcile-harness-compares-temporal-projections.md)：真实 Role NOT_APPLIED 已归档但 harness 误报，改为审计重放前后最终副作用与 Projection Digest 不变。
- [并行 E2E Restate 容器会耗尽共享 Docker 内存](./parallel-e2e-restate-containers-exhaust-docker-memory.md)：Vitest 文件级并发会同时启动多个 Restate，改为单 worker 串行门禁并保留完整覆盖。
- [Core v2 矩阵复用 Workflow 探针 key 后被旧 Deployment 钉住](./core-v2-matrix-reuses-stale-workflow-probe-key.md)：suite 重注册复用同一 Workflow identity 后路由到已停止的临时 Service，改为每次注册使用唯一探针 Task ID。
- [Core v2 Observer 验收超时早于 Session 证据产生](./core-v2-observer-timeout-precedes-session-evidence.md)：1 秒受控超时在 Codex 建立 Session 前发生，失败事实保留并用新 Task 覆盖 Session 建立后的超时边界。
- [Core v2 stale-fence 验收错误比较 Closure 对象引用](./core-v2-stale-fence-harness-compares-closure-object-identity.md)：跨 HTTP 响应比较对象 identity 误报 Projection mutation，改为比较内容寻址 Closure Digest 并附着原 Task 重审计。
- [Core v2 Roadmap 落后于 Sealed Runtime Receipt](./core-v2-roadmap-lags-sealed-runtime-receipts.md)：TASK-0030～0048 的部分交付状态仍停留在 Seal 前快照，缺少实际 Result Commit 与 Package Digest 台账。
- [seal-start 在 Active package 预检前提交 Runtime Invocation](./seal-start-dispatches-before-active-package-preflight.md)：真实 TASK-0049 在第一条 durable command 因 package 不存在而完成失败，且未形成可恢复的业务 Projection。
- [Core v2 审计画布压缩主流程且节点证据层级不清](./core-v2-audit-graph-compresses-path-and-buries-evidence.md)：真实 Happy Path 的 52 条合法边压缩主流程并放大 Recovery 空白，节点与 Domain Event 仍缺少稳定审计层级。
- [Task Audit 画布仍重复展示状态且通用异常分区过大](./task-audit-canvas-remains-oversized-and-repetitive.md)：最新 Sealed Task 仍重复展示多层归档状态，并命中未压缩的通用黄色异常分区。

不要为了演示目录创建虚构 Bug。
