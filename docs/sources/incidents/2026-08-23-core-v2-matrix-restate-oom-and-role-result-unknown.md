# Incident：Core v2 全矩阵首轮因 Restate OOM 暴露 Role 回执未知

> 状态：Resolved / History Preserved  
> 日期：2026-08-23  
> 严重级别：Core v2 product acceptance blocked  
> 负责人：Moye  
> 来源或关联 Task：TASK-0048、TASK-ACCEPT-20260823171349-01-HAPPY

## Summary

TASK-0048 首轮全矩阵在真实 Happy Path 的 Final Review 边界中断。六个真实 Role、Candidate Commit 和 Trusted Test 已完成；Restate 容器随后被宿主机以 OOMKilled/exit 137 终止，原 Service 停止后 Invocation 进入 backing-off。Final Review 只留下 append-only execution Intent，没有 Manifest。底层 Role Runtime 正确拒绝盲目重放，但 CoreV2Workflow 没有把该事实投影成 `WAITING_RECONCILE`。

该 Task 没有被当作 Happy Path 证据。原 Invocation 已暂停并保留，Task 通过合法 `CoreV2FailureRecoveryWorkflow` successor 完成失败 Closure 和 Archive，最终为唯一 `CLOSED + FAILED_TERMINAL + ARCHIVED`。

## Impact

- 首轮全矩阵停止，必须使用新 Task ID 重跑；
- 原 Task 保留六个 Role Session、Candidate、Trusted Test 与 Final Review Intent；
- 没有重复执行 Final Review、Test、Commit 或 Merge；
- 暴露出 Role UNKNOWN 只能停在 Restate 重试层、Board 无法解释等待原因的产品缺口。

## Timeline

| 时间（Asia/Shanghai） | 事件 |
|---|---|
| 17:13 | 提交 `TASK-ACCEPT-20260823171349-01-HAPPY` 到真实 CoreV2Workflow |
| 约 17:19 | Architect、Design Review、Implementation、Documentation、Test Plan/Assessment 完成，Candidate 与 Trusted Test Evidence 落盘 |
| 约 17:20 | Final Review Intent 落盘后 Restate 容器 OOMKilled，原 Invocation backing-off |
| 后续 | 以原部署端口恢复 Service，确认 Role Runtime 返回 `REAL_ROLE_RESULT_UNKNOWN` |
| 后续 | 暂停原 Invocation，校验 Invocation/Projection Digest，启动 append-only Failure Recovery successor |
| 后续 | successor 完成 Failure Artifact、Knowledge Disposition、Closure 和 Archive |
| 19:22 | 长批次再次触发 OOM；已完成 Task 均保持归档，Runtime 在持久化数据上恢复 |
| 19:56 | 16 个最终场景完成实时统一审计，0 Finding；所有失败/补跑历史保留 |

## Detection

顶层真实矩阵命令非零退出；Docker 状态显示 `OOMKilled=true`、exit 137。Restate Invocation 检查显示失败 command 为 Final Review Role command；Artifact 目录存在 `execution-intent.json` 且不存在 `manifest.json`。

## Root Cause

已确认的直接原因是专用 Restate 容器在真实多 Agent 运行中超出可用内存。Workflow 侧的独立缺陷是：`ctx.run` 内的 `REAL_ROLE_RESULT_UNKNOWN` 被 durable command 重试语义吸收，CoreV2Workflow 没有把 Role Intent-only 状态提升为可查询、可对账的业务状态。

## Contributing Factors

- 同一宿主机仍有旧 Board/Service 持续轮询当前 Restate；
- 同一 Compose 项目中的另一个 Restate/Phoenix 实例同时占用内存；
- 顶层 harness 在 suite 失败后停止父 Service，使原固定 deployment URI 不再可达。

## Resolution

- 保留并暂停原 Invocation，不取消、不 purge、不复用 Workflow key；
- 使用 Authority 校验过的 append-only Failure Recovery successor 收敛失败 Task；
- 停止同项目非本轮所需的 Restate/Phoenix 容器，使用持久化专用 Restate；
- TASK-0048 增加 Role UNKNOWN 的正式 `WAITING_RECONCILE` 投影与严格 token/evidence 对账；
- 新矩阵使用全新运行根和 Task ID 重跑。
- E2E 固定为单 worker；真实矩阵按 suite 串行，状态轮询降为 1 秒；接近配额时只在持久化 Role 边界重启 Restate；
- Deployment 注册探针每次使用唯一 Workflow identity，补跑/重审计显式绑定场景根，不覆盖原 Evidence。

## Evidence

- Task：`TASK-ACCEPT-20260823171349-01-HAPPY`；
- 原 Invocation：`inv_18BGjvU4PD2o1JEqBaXMsvZBuizDXvuvyd`；
- 原 Workflow：`restate://CoreV2Workflow/TASK-ACCEPT-20260823171349-01-HAPPY`；
- Recovery Workflow：`restate://CoreV2FailureRecoveryWorkflow/TASK-ACCEPT-20260823171349-01-HAPPY`；
- Candidate Commit：`c3ca0507137031feb3d41aadf12719c50c345277`；
- Final Review Run：`sha256:1a798dce1d84ee44ac458194f1e45bea57aceb578ef7fab4630c021472590623`；
- Source Projection Digest：`sha256:65e33b8c75c176d3547748c717dd01cefaa677e2ac8f977bb2ab76e173d3118c`；
- Invocation Fact Digest：`sha256:e2c3543f9fd38673207a35c6b8e514146fed0aaf1efb451d311a433f647849f4`；
- 本地恢复输入：`.moye-runtime/TASK-0048-oom-happy-recovery.json`；
- 首轮运行根：`.moye-runtime/acceptance/core-v2/matrix-20260823171348-38923`。
- 最终统一审计：`.moye-runtime/acceptance/core-v2/matrix-final-20260824/audit-report.json`；
- 审计摘要：`sha256:96ad9fc920bf960767bb519de19007691b87fde9955d50b525f38eaf3a40de86`。

## Backlog Outputs

| Backlog ID | 类型 | 说明 | 状态 |
|---|---|---|---|
| BL-0052 | Bug | Role Intent-only 必须进入正式 WAITING_RECONCILE | Converted to TASK-0048 |
| BL-0053 | Prevent / Detect | 矩阵使用专用容量并在 harness 失败时冻结诊断证据 | Converted to TASK-0048 |
| BL-0055 | Prevent | Restate E2E 单 worker，避免并行容器争抢共享 Docker 内存 | Converted to TASK-0048 |
| BL-0056 | Prevent | 每次 Deployment 注册使用唯一 Workflow probe identity | Converted to TASK-0048 |

## Knowledge Promotion

- Pitfall：需要补充“durable command 内 UNKNOWN 必须返回为业务值”和“真实矩阵隔离运行容量”；
- ADR：否，继续遵守未知副作用先 Reconcile 和 append-only recovery 不变量；
- Architecture/Runbook：由 TASK-0048 同步更新。
