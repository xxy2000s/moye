# Core v2 Delivery Roadmap

> 文档类型：Delivery Plan  
> 状态：Completed
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
                    → TASK-0039 unified workflow + real acceptance
```

## 4. 最终真实验收矩阵

TASK-0039 至少运行并保存以下真实证据：

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

Core v2 真实闭环与可运行画布已完成。后续仍不在本路线实现多 Daemon/Lease/Fencing、远程 PR、权限、多租户、生产级观测或长期知识效果反馈；这些能力继续由现有 Backlog 调度。
