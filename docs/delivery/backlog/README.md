# Backlog

Backlog 是 Sources 与可执行 Task 之间的归一化工作队列。每个条目使用稳定 ID，例如 `BL-0014`。

```text
CAPTURED → TRIAGED → READY → SCHEDULED → CONVERTED_TO_TASK
                └──> DEFERRED / DUPLICATE / REJECTED
```

Backlog Item 只需要表达问题、优先级、来源、影响范围和粗粒度验收方向，不应提前复制完整 Task Spec。

## 当前条目

| ID | 状态 | 标题 | Task |
|---|---|---|---|
| [BL-0082](./BL-0082.yaml) | Converted | 让真实 Core v2 验收任务默认保存可读取的 Agent Session Evidence | TASK-0076 |
| [BL-0001](./BL-0001.yaml) | Converted | 实现可恢复 Task 生命周期、Archive 与项目看板 | TASK-0001 |
| [BL-0002](./BL-0002.yaml) | Converted | 实现首个真实单 Agent 本地编码闭环 | TASK-0003～TASK-0007 |
| [BL-0003](./BL-0003.yaml) | Converted | 实现 Repair、Replan 与中央重试预算 | TASK-0016 |
| [BL-0004](./BL-0004.yaml) | Triaged | 实现多 Daemon 调度、租约与安全交接 | — |
| [BL-0005](./BL-0005.yaml) | Triaged | 接入远程 Git Provider 与 PR/Merge 闭环 | — |
| [BL-0006](./BL-0006.yaml) | Triaged（部分消费） | 建设生产级 Trace、运营指标与异常看板 | TASK-0017（Core 子集） |
| [BL-0007](./BL-0007.yaml) | Triaged（部分消费） | 实现经验候选、知识提升与效果反馈闭环 | TASK-0017（Core 子集） |
| [BL-0008](./BL-0008.yaml) | Converted | 将 Backlog 文档幂等同步到项目看板 | TASK-0002 |
| [BL-0009](./BL-0009.yaml) | Converted | 让一键 Demo 展示可理解的编码任务与 Agent 流转 | TASK-0008 |
| [BL-0010](./BL-0010.yaml) | Converted | 实现轻量 Agent Runtime Trace 与 Phoenix Demo | TASK-0009 |
| [BL-0011](./BL-0011.yaml) | Converted | 在 Moye 看板内联查看 Agent Events | TASK-0010 |
| [BL-0012](./BL-0012.yaml) | Converted | 接入真实 Agent 完整事件流与交互看板 | TASK-0011 |
| [BL-0013](./BL-0013.yaml) | Converted | 将 Agent Events 改为独立弹窗 | TASK-0012 |
| [BL-0014](./BL-0014.yaml) | Converted | 实现 Core ControlDecision 与确定性控制内核 | TASK-0013 |
| [BL-0015](./BL-0015.yaml) | Converted | 统一 Docs、Implementation 与 Review Role Attempt 协议 | TASK-0014 |
| [BL-0016](./BL-0016.yaml) | Converted | 实现 Self Review、ReviewResult 与 Finding 生命周期 | TASK-0015 |
| [BL-0017](./BL-0017.yaml) | Converted | 将最终 Docs Impact 与 Knowledge Sync 接入 Core Workflow | TASK-0017 |
| [BL-0018](./BL-0018.yaml) | Converted | 实现统一 Core Closure Gate 与故障收敛矩阵 | TASK-0018 |
| [BL-0019](./BL-0019.yaml) | Converted | 修复 CLI close 未附着既有 TaskWorkflow | TASK-0021 |
| [BL-0020](./BL-0020.yaml) | Converted | 把真实 Agent 编码闭环接入 Moye 页面 | TASK-0019 |
| [BL-0021](./BL-0021.yaml) | Converted | 在 Board 展示可审计的 Task 状态机 | TASK-0020 |
| [BL-0022](./BL-0022.yaml) | Converted | 把真实多角色 Core 接入可全程审计的单任务产品流 | TASK-0021 |
| [BL-0023](./BL-0023.yaml) | Converted | 把全部 Session Events 统一为 Chatbot 弹窗 | TASK-0022 |
| [BL-0024](./BL-0024.yaml) | Converted | 将完整 Task 状态机呈现为实际路径点亮的 Graph 画布 | TASK-0023 |
| [BL-0025](./BL-0025.yaml) | Converted | 将 Task 详情重构为居中画布优先的审计工作区 | TASK-0024 |
| [BL-0026](./BL-0026.yaml) | Converted | 补齐状态机节点的执行与系统管控下钻 | TASK-0025 |
| [BL-0027](./BL-0027.yaml) | Converted | 重构节点 Inspector 并内联 Agent Events 预览 | TASK-0026 |
| [BL-0028](./BL-0028.yaml) | Converted | 优化状态机边标签与合法路径详情 | TASK-0027 |
| [BL-0029](./BL-0029.yaml) | Converted | 将单任务审计改为全屏路由并重构 Domain Event 时间线 | TASK-0028 |
| [BL-0030](./BL-0030.yaml) | Converted | 持久化本地 Restate 并明确历史投影恢复边界 | TASK-0028 |
| [BL-0031](./BL-0031.yaml) | Converted | 让 Bootstrap 基线错误在派发前失败并收敛 Runtime 终态 | TASK-0029 |
| [BL-0032](./BL-0032.yaml) | Converted | 冻结 Core v2 的 5+1 Agent 架构与提交归档边界 | TASK-0030 |
| [BL-0033](./BL-0033.yaml) | Converted to Task | 将 Core v2 研发生命周期文档建模为一等 Artifact | TASK-0031（Active） |
| [BL-0034](./BL-0034.yaml) | Converted to Task | 实现五类 Agent 共用的真实 Role Runtime v2 | TASK-0032（Archived） |
| [BL-0035](./BL-0035.yaml) | Converted to Task | 接入 Architect 与隔离 Design Review | TASK-0033（Sealed） |
| [BL-0036](./BL-0036.yaml) | Converted to Task | 接入 Implementation、Self Review 与 Repair Checkpoint | TASK-0034（Sealed） |
| [BL-0037](./BL-0037.yaml) | Converted to Task | 接入真实 Documentation Agent 与文档门禁 | TASK-0035（Sealed） |
| [BL-0038](./BL-0038.yaml) | Converted to Task | 实现独立 Test Verification Agent 与 Trusted Runner | TASK-0036（Sealed） |
| [BL-0039](./BL-0039.yaml) | Converted to Task | 接入 Final Review 与确定性 Verification Gate | TASK-0037（Sealed） |
| [BL-0040](./BL-0040.yaml) | Converted | 统一 Core v2 Workflow 并完成真实故障矩阵验收 | TASK-0039 |
| [BL-0041](./BL-0041.yaml) | Converted to Task | 恢复错误 Seal Evidence 导致的已失败自举任务 | TASK-0032R1（Sealed） |
| [BL-0042](./BL-0042.yaml) | Converted to Task | 补齐 Core v2 失败 Closure、Archive 与历史失败收敛 | TASK-0040（Sealed） |
| [BL-0043](./BL-0043.yaml) | Scheduled（执行中） | 完成 Core v2 真实 Agent 产品级故障矩阵 | TASK-0041/0043/0044（Archived）；TASK-0045（Active）；TASK-0046～0048（Planned） |
| [BL-0044](./BL-0044.yaml) | Converted to Task | 以 append-only successor 恢复 TASK-0040 Docs Impact Seal 失败 | TASK-0040R1（Archived / Succeeded） |
| [BL-0045](./BL-0045.yaml) | Converted to Task | 允许 Sealed Recovery Attempt 形成任意长度 append-only chain | TASK-0040R2（Seal Prepared） |
| [BL-0046](./BL-0046.yaml) | Scheduled | 为 journaled durable command failure 增加 Core v2 append-only recovery successor | TASK-0042（Active） |
| [BL-0047](./BL-0047.yaml) | Scheduled | 补齐 Core v2 成功 Closure 与真实 Archive Effect | TASK-0042（Active） |
| [BL-0048](./BL-0048.yaml) | Scheduled | 兼容 Core v2 历史 Recovery Projection 的 Trace nullable 字段 | TASK-0042（Active） |
| [BL-0049](./BL-0049.yaml) | Converted to Task | 以规范 Verification 状态恢复 TASK-0042 Seal 失败 | TASK-0042R1（Active） |
| [BL-0050](./BL-0050.yaml) | Converted to Task | 修复 Core v2 Board 运行状态语义与验收历史筛选 | TASK-0046（Seal Prepared） |
| [BL-0051](./BL-0051.yaml) | Converted to Task | 防止 Sealed Task 归档后文档图仍保留 Active 状态 | TASK-0047（Active） |
| [BL-0052](./BL-0052.yaml) | Converted to Task | 将 Core v2 Role Intent-only 提升为正式 WAITING_RECONCILE | TASK-0048（Seal Prepared） |
| [BL-0053](./BL-0053.yaml) | Converted to Task | 隔离 Core v2 真实矩阵运行容量并冻结 harness 失败证据 | TASK-0048（Seal Prepared） |
| [BL-0054](./BL-0054.yaml) | Converted to Task | 修正 Core v2 Reconcile 验收的幂等判定 | TASK-0048（Seal Prepared） |
| [BL-0055](./BL-0055.yaml) | Converted to Task | 限制 Restate E2E 并发以避免共享 Docker OOM | TASK-0048（Seal Prepared） |
| [BL-0056](./BL-0056.yaml) | Converted to Task | 为 Core v2 矩阵注册使用唯一 Workflow 探针 identity | TASK-0048（Seal Prepared） |
| [BL-0057](./BL-0057.yaml) | Converted to Task | 校准 Observer 超时验收以保留真实 Session/Event | TASK-0048（Seal Prepared） |
| [BL-0058](./BL-0058.yaml) | Converted to Task | 修正 stale-fence 验收的 Closure 内容身份比较 | TASK-0048（Seal Prepared） |
| [BL-0059](./BL-0059.yaml) | Converted to Task | 修正 Core v2 Roadmap 的 Runtime 终态与 Result Commit 台账 | TASK-0049R1（Seal Prepared） |
| [BL-0060](./BL-0060.yaml) | Converted to Task | 让 seal-start 在派发前验证 Active Task package | TASK-0049R1（Seal Prepared） |
| [BL-0061](./BL-0061.yaml) | Converted to Task | 重构 Core v2 状态机画布与节点审计信息层级 | TASK-0050（Seal Prepared） |
| [BL-0062](./BL-0062.yaml) | Converted to Task | 收紧 Core v2 Recovery / Exception 画布分区 | TASK-0051（Seal Prepared） |
| [BL-0063](./BL-0063.yaml) | Converted to Task | 补齐 Board Task 时间并重构详情页局部 Tab | TASK-0052（Seal Prepared） |
| [BL-0064](./BL-0064.yaml) | Converted to Task | 收敛 Task Audit 重复摘要与通用画布空白 | TASK-0053（Seal Prepared） |
| [BL-0065](./BL-0065.yaml) | Converted to Task | 统一角色与交付物执行台账的自适应布局 | TASK-0054（Seal Prepared） |
| [BL-0066](./BL-0066.yaml) | Converted to Task | 修复 Task 详情 Tab 的 overflow 与焦点显示伪影 | TASK-0055（Seal Prepared） |
| [BL-0067](./BL-0067.yaml) | Converted to Task | 引入分级开发执行模式 | TASK-0056（Seal Prepared） |
| [BL-0068](./BL-0068.yaml) | Scheduled（M2 执行中） | 将 Core v2 产品化为可被外部项目直接使用的开发框架 | TASK-0066～0068；TASK-0069～0075（Frozen） |
| [BL-0069](./BL-0069.yaml) | Converted to Task | 补齐 Core v2 完整 Agent Session 与 Prompt 证据链 | TASK-0058～0065（M1，已归档） |
| [BL-0070](./BL-0070.yaml) | Converted to Task | 恢复 TASK-0058 Seal 失败并前移 Accepted Verification 预检 | TASK-0058R1 |
| [BL-0071](./BL-0071.yaml) | Converted to Task | 修复 Claude Role Runtime 忽略 structured_output | TASK-0060 |
| [BL-0072](./BL-0072.yaml) | Converted to Task | 兼容 Codex 当前 item_completed 对话记录 | TASK-0061 |
| [BL-0073](./BL-0073.yaml) | Converted to Task | 消除 Core v2 重放配置分叉并恢复 pre-dispatch Journal mismatch | TASK-0061R1 |
| [BL-0074](./BL-0074.yaml) | Converted to Task | 在 Framework Task 派发前验证目标 Git ref | TASK-0068 |
| [BL-0075](./BL-0075.yaml) | Converted to Task | 修复 Runtime 验收对一次性 registrar 的状态查询 | TASK-0071 |
| [BL-0076](./BL-0076.yaml) | Converted to Task | 为 Runtime 备份恢复固定并校验 Restate node name | TASK-0071 |
| [BL-0077](./BL-0077.yaml) | Converted to Task | 让 Framework 产品矩阵自举验收 Service 并快速暴露 Invocation 失败 | TASK-0074 |
| [BL-0078](./BL-0078.yaml) | Converted to Task | 统一 Recovery Harness 的测试 argv 与验收文字 | TASK-0074 |
| [BL-0079](./BL-0079.yaml) | Converted to Task | 让跨版本恢复 Harness 对账长 Role 并持久保存新版本 Commit | TASK-0074 |
| [BL-0080](./BL-0080.yaml) | Converted to Task | 收敛 W10 非 canonical Runtime Seal 并形成 canonical handoff | TASK-0075R1 |
| [BL-0081](./BL-0081.yaml) | Converted to Task | 为 W09 Framework Matrix 增加独立 live recheck digest | TASK-0075 |

## 本轮调度结果

连续 Goal 已先通过 TASK-0002 消费 BL-0008，再通过 TASK-0003 至 TASK-0007 顺序消费 BL-0002。具体能力切片、范围排除和自举约束见 [夜间多 Task 自举开发目标](../../sources/brainstorm/overnight-multi-task-goal.md)，最终证据从 [Archived Tasks](../tasks/archive/README.md) 查询。

Backlog 的 `resolution.task_refs` 只登记实际创建过的稳定 Task ID；它不替代 Runtime Task 状态，执行与归档事实仍以 Task Projection 和归档证据为准。

多 Agent Core 闭环按母需求的六个 Slice 顺序调度：BL-0014、BL-0015、BL-0016、BL-0003、BL-0006/BL-0007/BL-0017、BL-0018。Slice 1～5 已归档，Slice 6 已创建 TASK-0018；BL-0006/BL-0007 只部分消费并保留生产范围。

新建时复制 [`backlog-item.yaml`](../../meta/templates/backlog-item.yaml)，文件名使用 `<backlog-id>.yaml`。
