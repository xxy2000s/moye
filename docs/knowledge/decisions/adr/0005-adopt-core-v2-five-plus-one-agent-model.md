# ADR-0005：采用 Core v2 五个主流程 Agent 加一个旁路 Agent

> 状态：Accepted
> 日期：2026-08-23
> 决策者：Moye Core
> 关联文档：[Core v2 Agent Lifecycle](../../current/architecture/core-v2-agent-lifecycle.md)

## Context

旧模型把 Docs、Knowledge 混在一个角色中，并用确定性 Verification Gate 代替独立测试分析，无法形成 Spec→Design→Implementation→Documentation→综合测试→独立审查的真实研发闭环。

## Decision

主流程采用 `ARCHITECT | IMPLEMENTATION | DOCUMENTATION | TEST_VERIFICATION | REVIEW` 五类 Agent。REVIEW 必须用隔离 Attempt 分别执行 Design Review 与 Final Review；TEST_VERIFICATION 使用 TEST_PLAN 与 TEST_ASSESSMENT 两个阶段，真实命令由 Trusted Runner 执行。

`OBSERVER_KNOWLEDGE` 是可选非阻塞旁路 Agent；确定性 Observer 是系统投影。Closure 只要求 Knowledge Disposition，不要求旁路 Agent 成功或每次生成知识。Verification Gate、Trusted Runner、确定性 Observer 均不是 Agent。

## Consequences

- 测试结论与实现者自证分离，所有结论必须绑定真实 Evidence；
- Documentation 可修改当前事实，Knowledge 只能提出候选，权限更清楚；
- 主流程 Agent 数量固定为五类，但 Review/Test 的多个 Attempt 不增加角色种类；
- 角色增多会增加成本，由中央 Budget 和按 Finding 返工约束。

## Rejected

- 把 TEST_VERIFICATION 合并进 Implementation：缺少独立质量结论；
- 把 Knowledge 作为每次 Closure 的阻塞 Agent：无知识产出时制造无意义等待；
- 把 Verification Gate 称为 Agent：会混淆分析建议与确定性状态门禁。
