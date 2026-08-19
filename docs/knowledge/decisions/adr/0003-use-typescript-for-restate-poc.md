# ADR-0003：首个 Restate PoC 使用 TypeScript

> 状态：Accepted  
> 日期：2026-08-19  
> 决策者：Moye PoC  
> 关联文档：[实现基线 Research](../../../sources/research/restate-typescript-implementation-baseline.md)、[Restate PoC 架构](../../current/architecture/poc-01-restate.md)

## Context

ADR-0001 已决定使用 Restate 开展首个 Runtime PoC，但尚未固定实现语言和 SDK 版本。当前工作区具备 Node.js 22，Restate 官方 TypeScript SDK 与 Server 1.7 兼容，并提供 Workflow、状态、测试和 OpenTelemetry 能力。

## Decision Drivers

- 最快形成可运行的 Durable Workflow 和 Board；
- 使用官方维护且版本兼容的 SDK；
- 方便编写浏览器看板、CLI 和故障注入测试；
- 保持领域层可脱离 Restate 测试。

## Considered Options

1. TypeScript + Restate SDK；
2. Go + Restate SDK；
3. Ruby 自建流程；
4. 仅编写模拟器，不运行真实 Restate。

## Decision

首个 PoC 使用 Node.js 22、TypeScript、`@restatedev/restate-sdk@1.16.7` 和 `@restatedev/restate-server@1.7.4`。Ruby 只保留现有文档图谱工具，不承担 Task Workflow。

外部 PoC 驱动优先使用 Restate HTTP Ingress；领域规则保持无 SDK 依赖。

## Consequences

### Positive

- 与当前本机运行时和官方 SDK 基线匹配；
- 前后端与测试使用同一语言；
- 可以用真实 Server 验证进程退出恢复。

### Negative

- 增加 Node/npm 工程依赖；
- 必须隔离 Restate SDK 类型和版本变化；
- TypeScript 并不自动解决领域幂等和文件系统 Reconcile。

### Risks

- SDK/API 升级导致示例失效；通过固定版本和 E2E 测试控制；
- 把 Restate Journal 当作完整 Task 业务模型；通过独立 Domain 和 Projection 控制。

## Validation

- 领域单元测试不启动 Restate；
- 集成测试使用真实 Restate Server 1.7.4；
- Worker 强制退出后 Workflow 恢复并产生唯一 Archive；
- Board 能读取恢复后的最终 Projection。

## Supersession

- Supersedes：无；
- Superseded by：无。
