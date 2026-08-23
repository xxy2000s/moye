# Core v2 Delivery Roadmap

> 文档类型：Delivery Plan  
> 状态：Core v2 PoC 关键矩阵已验收；生产能力继续演进
> 基线日期：2026-08-23  
> 需求来源：[Core v2：5+1 Agent 研发闭环需求基线](../sources/brainstorm/core-v2-five-plus-one-agent-requirements.md)  
> 当前实现事实仍以 Architecture、代码、测试和已归档 Task 为准。

## 1. 执行规则

- 严格按依赖顺序执行 `TASK-0029` 至 `TASK-0039`；当前 Task 验收、关闭并归档后才创建下一个 Active Task Package；
- 每个 Task 绑定一个独立 Result Commit，提交信息和 Task Artifact 都包含稳定 Task ID；不得把多个实现 Task 混入同一个 Result Commit；
- Runtime 生成的 Closure/Archive 证据属于该 Task 的管理事实，不得伪装成另一个实现 Task；TASK-0030 已决定并实现两阶段 Seal，Result SHA 和最终业务 Outcome 保存在 Runtime Receipt，Git package 永久保持 `seal_prepared` 以避免自引用；
- 每个 Task 都必须有 Requirement → Test → Evidence 映射、针对风险的失败路径测试、`npm run check`、目标 E2E 和 Docs Impact Gate；
- 自动化测试中的 Fake 只允许证明低层协议；产品能力验收必须使用真实 Restate、真实进程、真实 Git 和真实受控命令，Agent 能力验收使用真实 Agent Runner；
- 路线图只协调交付，不定义当前架构。重大取舍进入 ADR，当前设计进入 Architecture。

## 2. 固定任务序列

| Task | Backlog | 状态 | 目标与核心验收 | Result Commit |
|---|---|---|---|---|
| TASK-0029 | BL-0031 | Archived / Succeeded | Bootstrap 派发前预检、派发后失败终态收敛、TASK-0028 合法恢复；真实 Restate 证明 Board/Event/Archive 一致 | `d5edefd` |
| TASK-0030 | BL-0032 | Sealed / Runtime authoritative | 冻结 Core v2 Architecture、状态权威、5+1 角色、两阶段提交/归档边界与 ADR；消除一个 Task 一个 Result Commit 的循环证据问题 | `SealedTaskWorkflow` Receipt |
| TASK-0031 | BL-0033 | Sealed / Runtime authoritative | 将 Spec、Design、Plan、Docs Impact、Test Plan、Test Report、Review、Knowledge Disposition 建模为带 Revision/Digest 的一等 Artifact | `SealedTaskWorkflow` Receipt |
| TASK-0032 | BL-0034 | Sealed / Runtime authoritative | 统一真实 Role Runtime v2：五类角色共享 Attempt/Generation/Session/Event/Artifact/Reconcile 协议，禁止产品路径回退 Fake | `SealedTaskWorkflow` Receipt |
| TASK-0033 | BL-0035 | Sealed / Runtime authoritative | 接入 ARCHITECT 与隔离 DESIGN_REVIEW；Spec/Design 缺陷可 REPLAN 到 Revision R+1 | `SealedTaskWorkflow` Receipt |
| TASK-0034 | BL-0036 | Sealed / Runtime authoritative | 接入 IMPLEMENTATION、代码/测试写入、Self Review、Checkpoint；实现缺陷可 REPAIR 到 Attempt N+1 | `SealedTaskWorkflow` Receipt |
| TASK-0035 | BL-0037 | Sealed / Runtime authoritative | 接入 DOCUMENTATION，真实修改项目当前事实并完成 Context Re-route、Graph 与 Docs Impact Gate | `SealedTaskWorkflow` Receipt |
| TASK-0036 | BL-0038 | Sealed / Runtime authoritative | 接入 TEST_PLAN、Trusted Runner、TEST_ASSESSMENT 和综合测试报告；UNKNOWN 进入 Reconcile 而非重复测试 | `SealedTaskWorkflow` Receipt |
| TASK-0037 | BL-0039 | Sealed / Runtime authoritative | 接入隔离 FINAL_REVIEW 与确定性 Verification Gate，绑定 Spec Revision、Candidate Commit、报告和 Evidence Digest | `SealedTaskWorkflow` Receipt |
| TASK-0038 | BL-0006、BL-0007 | Sealed / Runtime authoritative | 建成确定性 Observer 投影和非阻塞 OBSERVER_KNOWLEDGE；旁路崩溃不阻塞 Closure，Knowledge Disposition 必填 | `SealedTaskWorkflow` Receipt |
| TASK-0039 | BL-0040 | Sealed / Runtime authoritative | 统一 Workflow 串起 Intake→Archive、Repair/Replan/Reconcile/Merge/Closure；CLI、Board 与真实 Agent/Runner/Git 完成最终验收 | `SealedTaskWorkflow` Receipt |
| TASK-0040 | BL-0042 | Archived / Succeeded via Recovery | 失败 Closure/Artifact/Knowledge/Archive、Archive-only retry 与 LIVE-001～004 append-only 合法收敛；原失败与两段失败 successor 均保留 | `ac213a5` / `sha256:3e2627…c1ce` |
| TASK-0040R1 | BL-0044 | Archived / Succeeded via Recovery | 保留原 Seal 与两段 recovery 失败，以 corrected Evidence append-only 收敛 | `692981d` / `sha256:95d8b2…bdc2` |
| TASK-0040R2 | BL-0045 | Seal Prepared | 修复 numbered recovery 无法从已失败 Attempt 继续追加的问题；真实 Restate 与历史 Task 均已通过 | Intent `sha256:d0b1…3f10` |
| TASK-0041 | BL-0043 | Archived / Succeeded | 真实、幂等、可对账的 Merge Effect；真实 Agent Task 证明 ref 更新后进程终止、唯一双父 Merge 与 `ALREADY_APPLIED`；同时修复 Role 物理路径、Failure Artifact 命名空间和 Trusted Test 文件 Digest | `34c07dc` / `sha256:21ec68…2275` |
| TASK-0042 | BL-0046、BL-0047、BL-0048 | Archived / Succeeded via Recovery | 成功 Closure/Archive Receipt、Archive-only retry、journaled command append-only successor、历史 Trace schema 兼容，并合法收敛 001/003/004 | `a1942f3` / `sha256:d29089…a2ff` |
| TASK-0042R1 | BL-0049 | Archived / Succeeded | 保留 TASK-0042 rejected Commit，以规范 Verification 状态的 sibling Evidence append-only 收敛原 Seal | `56f1d18` / `sha256:81bc2d…cb4d` |
| TASK-0043 | BL-0043 | Seal Prepared / Runtime authoritative | 真实 Agent Happy/Implementation/Final Review/Documentation/Test/Design Replan 场景全部逐 Task 通过；未筛选五场景 Fault 命令全量复跑通过 | `SealedTaskWorkflow` Receipt |
| TASK-0044 | BL-0043 | Archived / Succeeded | 五个独立真实 Task 完成 Test UNKNOWN 两分支、Role Worker 中断、Git Candidate Checkpoint 与 Merge 回执未知验收；恢复 Harness 清理另有零场景 smoke 证据 | `aa9473e` / `sha256:9d3d76…8dc7` |
| TASK-0045 | BL-0043 | Seal Prepared / Runtime authoritative | 三个独立真实 Task 完成 Repair/Replan 预算失败归档、Observer 超时非阻塞和旧 Generation/Revision Manifest fencing | `SealedTaskWorkflow` Receipt |
| TASK-0046 | BL-0043、BL-0050 | Archived / Succeeded | Board outcome/workflow/history 筛选、验收历史标识、失败详情与实际路径语义；57 个持久化 Runtime Task 与真实 Role Events 完成桌面/移动验收 | `3cedfa5` / `sha256:3e5df1…c6a44` |
| TASK-0047 | BL-0043、BL-0051 | Seal Prepared / Runtime authoritative | 显式矩阵 Manifest、实时 Restate/Board/Git/Artifact/Graph 交叉审计；旧 14 场景以 25 个缺失声明/绑定 Finding 正确 fail closed，不能冒充新矩阵通过 | `SealedTaskWorkflow` Receipt |
| TASK-0048 | BL-0043、BL-0052～BL-0058 | Verification Accepted / Seal Pending | 16 个真实 Task、Role UNKNOWN 正式对账、统一零 Finding 审计、验收编排恢复与最终部署 | Audit `sha256:96ad9fc9…de86` |

本轮真实运行发现的 Closure/Recovery 缺口已进入 [BL-0046](./backlog/BL-0046.yaml) 与 [BL-0047](./backlog/BL-0047.yaml)，并由 TASK-0042 实现：journaled durable command 使用核验 Invocation/Projection 的合法 successor recovery；成功路径使用内容寻址 Closure 与独立 Archive Receipt。真实 `TASK-CORE-V2-SUCCESS-ARCHIVE-001` 已证明一次受控 Archive 失败后只重试 Archive 并唯一归档；LIVE 历史详情验收发现的旧 schema nullable Trace 缺陷登记为 BL-0048 并完成修复。TASK-0042 与恢复 Task TASK-0042R1 均已 append-only Seal/Archive，仍不代表后续完整故障矩阵已经通过。

## 3. 依赖图

```text
TASK-0029 Bootstrap correctness
  → TASK-0030 Core v2 contract + ADR
    → TASK-0031 lifecycle artifacts
      → TASK-0032 real role runtime
        → TASK-0033 architect/design review
          → TASK-0034 implementation/self review
            → TASK-0035 documentation
              → TASK-0036 test verification/trusted runner
                → TASK-0037 final review/verification gate
                  → TASK-0038 observer/knowledge sidecar
                    → TASK-0039 unified workflow + real Happy Path
                      → TASK-0040 failure closure + legacy convergence
                        → TASK-0041 real merge + TASK-0042 closure/recovery foundation
                          → TASK-0043～0045 real fault infrastructure + executions
                            → TASK-0046 board audit UX
                              → TASK-0047 evidence integrity + repeatability audit
                                → TASK-0048 final matrix rerun + deployment
```

## 4. 最终真实验收矩阵

TASK-0039 只完成了真实 Happy Path 基线。TASK-0048 使用全新 Workflow key 逐项执行下列矩阵，并以显式 Manifest 完成实时交叉审计：

| 场景 | 唯一预期结果 |
|---|---|
| Happy Path | 五类主流程 Agent、两次 Review、两阶段 Test、Gate、Merge、Closure、Archive 全部可追踪 |
| Implementation Finding | REPAIR 创建 N+1 Attempt，旧 Attempt 保持终态，后续 Docs/Test/Final Review 重跑 |
| Requirement/Design Finding | REPLAN 生成 Spec R+1，旧 Revision Evidence 不得通过新 Gate |
| Test UNKNOWN | `WAITING_RECONCILE`，不得启动第二次测试命令 |
| Agent/Worker 强杀 | 从 Event、Envelope、Checkpoint、Artifact 接管，已完成昂贵步骤不重复 |
| Merge/外部回执丢失 | 先 Reconcile，最终只存在一个合入和一个 Task 终态 |
| Observer/Knowledge 崩溃 | 主流程继续，确定性 Observer 可用，Disposition 为 deferred 或 none |
| Blocking Finding/Docs Impact 失败 | 不得成功关闭，按分类 Repair/Replan 或唯一失败终态 |
| 预算耗尽 | 唯一 `FAILED_TERMINAL`，不继续调用 Agent |
| CLI 全程跟踪 | 只用 CLI 发起并查询，Web 页面只读也能看到同一真实投影和节点证据 |

## 5. 明确延后

TASK-0048 的最终审计包含 16 个独立 Task：Happy、五类 Finding/Repair/Replan、六类 UNKNOWN/Recovery、两个预算终止、Observer timeout 与 stale fencing。报告重新查询实时 Workflow、Authority、Board、Git、Artifact 和 Document Graph，得到 `passed=true`、`findingCount=0`、`reportDigest=sha256:96ad9fc920bf960767bb519de19007691b87fde9955d50b525f38eaf3a40de86`。首轮 OOM、Role Intent-only、探针钉住、过短/过长 Observer timeout 和 Harness 误判均作为失败历史与 Finding 保留；补跑使用新 Task，stale 只读重审计没有重跑副作用。单元测试和确定性 Adapter E2E 仍只能补充协议证明，不能替代这份真实产品证据。

完整多 Daemon Lease/Fencing、远程 PR、权限、多租户、生产级观测或长期知识效果反馈仍属于生产阶段能力；本路线只对当前可实现的 Attempt/Generation/Revision fencing 做真实验收，并明确剩余限制。
