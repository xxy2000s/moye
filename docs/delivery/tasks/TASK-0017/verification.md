# TASK-0017 Verification

> 状态：Accepted
> 验证日期：2026-08-22
> Spec Revision：1

## 验收结论

TASK-0017 满足 Spec Revision 1：ObserverReport 可从只读 Core 事实确定性重建 Trace、Usage、Recovery、Alert 和 Knowledge Candidate；Final Context Route 覆盖初始计划并吸收实际 changed paths；Docs Impact 逐项处置、新 Markdown 注册和现有 Graph/Impact Validator 共同形成可恢复 Gate。失败不会推进 Closure，通过后才进入 `CLOSURE_REQUIRED`。

## Requirement 证据

- `REQ-0017-01`：Observer 校验 Envelope/Projection Digest 与 Attempt 归属，关联 Workflow、Attempt、Session、Commit、Artifact、Finding、Verification 和 Invocation；汇总时长、Model Call、Token/Cost 与四类恢复；相同输入生成相同 Report Digest；
- `REQ-0017-02`：停滞、重复失败、预算逼近与 UNKNOWN 生成稳定 Alert；Knowledge Candidate 固定 Source/Evidence、ID/Digest，`promotionStatus` 只能是 `PROPOSED`；
- `REQ-0017-03`：Final Route 合并 changed paths 和最终证据路径，拒绝 Required Read/Review 回退和 Graph Revision 回退；Ruby Adapter 以 `shell:false` argv 调用 Router；
- `REQ-0017-04`：Report 精确覆盖 Required Review，新增 Markdown 精确绑定 Graph/Relation/Index 声明；Graph 与 Impact 命令保存退出码/摘要；Blocked Gate 保持可恢复，Passed Gate 才推进 Closure Required；
- `REQ-0017-05`：新增 6 个 Observer/Docs Gate 场景，包含真实仓库 Router smoke；全量单元、真实 Restate E2E 和文档门禁通过。

## 自动化证据

- `npm run typecheck && npx vitest run tests/unit/core-observer.test.ts tests/unit/core-docs-impact.test.ts`：通过，2 个文件 6 项；
- `npm run check`：通过；TypeScript、23 个单元测试文件共 128 项及文档图谱校验通过；
- `npm run test:e2e`：通过；4 个真实 Restate E2E 文件共 11 项；
- `ruby scripts/docs_graph.rb validate`：通过，163 个文档节点、271 条关系、110 个 Markdown 文件；
- `git diff --check`：通过。

## 失败路径

- Observer Attempt 不在 Core Projection、时间顺序错误、成本/Token 非法：拒绝；Observer 异常不修改 Projection；
- Final Route 丢失初始 Required Read/Review 或 Graph Revision 回退：拒绝；
- Required Review disposition 缺失/重复/多余、理由为空：拒绝；
- 新 Markdown 未声明 Graph Node、Relation 或 Index：拒绝；
- Graph validate 或 validate-impact 非零：生成 `BLOCKED` Gate 并保持 `DOCS_IMPACT_REQUIRED`；相同 Gate 重放幂等；
- 未经领域协议构造或 Digest 篡改的 Route/Report/Gate/Verification：拒绝。

## 边界

- BL-0006/BL-0007 仅部分消费；生产运营平台、知识自动提升和长期反馈仍在 Backlog；
- 当前 Adapter 已复用真实 Router/Validator，但尚未被 keyed Restate Core Workflow 调用；
- 最终 Outcome、CoreClosureResult、取消/失败 Archive 和全边界 Worker Kill 属于 TASK-0018。
