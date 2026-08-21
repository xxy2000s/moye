# TASK-0017 Spec：Observer、Docs Impact Gate 与 Knowledge Candidate

> 状态：Approved for bootstrap execution
> Spec Revision：1
> Backlog：BL-0006 / BL-0007 / BL-0017
> 母需求：CORE-REQ-05 / CORE-REQ-06 / Slice 5

## 目标

为多角色 Core 增加可从只读事实重建的 ObserverReport，并把最终 Context Route、逐项 Docs Impact、Document Graph 校验和内容寻址 Knowledge Candidate 建模为可恢复 Gate。Observer 不拥有 Task 状态；候选不能自动提升为 Architecture、ADR、Pitfall 或 Runbook。

## Requirements

### REQ-0017-01：只读 ObserverReport

- 输入只包含 Core Projection 摘要、Event/Attempt/Artifact/Finding/Verification/Invocation 只读定位和成本样本；
- 输出关联 Task、Role Attempt、Session、Commit、Finding、Verification 与 Restate Invocation；
- 汇总阶段耗时、模型调用、Token/Cost、四类恢复次数和异常；
- 相同事实重跑产生相同 Report Digest，不修改 Core Projection。

### REQ-0017-02：告警与知识候选

- 长时间无进展、重复失败、预算逼近和 UNKNOWN 形成稳定 Alert Candidate；
- Finding、Observer 异常与失败证据可生成 `FINDING | BACKLOG | PITFALL | RUNBOOK | DOCS_IMPACT` Knowledge Candidate；
- Candidate 固定来源和证据 Digest；不能声明已提升或直接改写 Accepted ADR/Architecture；
- 相同候选输入重放收敛为相同 Candidate ID/Digest。

### REQ-0017-03：最终 Context Route

- 初始 Context Plan 绑定 TaskEnvelope；changed paths 扩张或最终 Candidate/失败证据产生时形成刷新后的 Final Route；
- Final Route 必须覆盖初始 Required Read/Review，记录新增项和最终 changed paths；
- 路由输入使用 argv，不使用 shell 拼接。

### REQ-0017-04：Docs Impact Gate

- Docs Impact 对 Final Route 每个 Required Review 提供 `updated | unchanged | not_applicable` 和非空理由；
- 新 Markdown 必须出现在图谱、至少一条关系和对应索引中；
- Gate 顺序执行 graph validate 与 validate-impact，保存命令、退出码和输出摘要；
- Gate 失败返回可恢复 `BLOCKED`，不得把 Core 推进到成功 Closure；通过后进入 `CLOSURE_REQUIRED`。

### REQ-0017-05：验证

- 测试覆盖 Observer 重建/崩溃隔离、告警去重、候选幂等、changed paths 扩张、逐项 disposition、新文档遗漏、validator 失败与恢复；
- `npm run check`、真实 Restate E2E、文档图谱和 Docs Impact Gate 通过。

## 非目标

- 不建设生产运营看板、Daemon 指标平台或长期效果反馈；
- 不允许模型或 Gate 自动改写 Accepted ADR/当前 Architecture；
- 本 Task 不生成最终 CoreClosureResult，不接入真实多角色模型进程。

## 完成定义

Observer 可从持久化只读事实重建同一报告；知识只形成待审核候选；最终 Route 和 Docs Impact 由真实 Validator 证据 Gate，失败保持可恢复且不会伪装为 CLOSED。
