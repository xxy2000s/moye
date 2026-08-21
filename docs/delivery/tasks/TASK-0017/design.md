# TASK-0017 Design

## 只读边界

`core-observer.ts` 是纯函数投影：输入均为已持久化摘要，输出内容寻址报告、告警和知识候选。它不接收 Core Reducer 写句柄；异常只使本次观察失败，主 Projection 不变。

## 文档 Gate

`core-docs-impact.ts` 分为纯领域对象与 Adapter：领域层验证 Final Route、逐项 disposition 和新 Markdown 注册声明；Adapter 只以 argv 调用既有 `scripts/docs_graph.rb route|validate|validate-impact`。Gate Result 固定两条校验证据，失败为 `BLOCKED`，可用相同输入重新执行，不直接关闭 Task。

## 状态接入

Core 只接受可信 `PASSED` Docs Impact Gate，并且当前 Stage 必须是 `DOCS_IMPACT_REQUIRED`；通过后进入 `CLOSURE_REQUIRED`。本 Slice 不消费 Closure，也不产生业务 Outcome。

## 边界

Knowledge Candidate 的 `targetKind` 只是建议类型，`promotionStatus` 固定 `PROPOSED`。任何 Accepted ADR 或当前 Architecture 变化仍必须由独立 Task/Docs Gate 明确提交。
