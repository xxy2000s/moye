# TASK-0001 Design

> 状态：Archived  
> Spec Revision：1  
> 关联：[Spec](./spec.md)、[ADR-0001](../../../../knowledge/decisions/adr/0001-use-restate-for-task-runtime-poc.md)、[ADR-0003](../../../../knowledge/decisions/adr/0003-use-typescript-for-restate-poc.md)

## 技术基线

- Node.js 22；
- TypeScript；
- Restate TypeScript SDK 1.16.7；
- Restate Server 1.7.4；
- 不引入前端框架，首版 Board 使用静态 HTML/CSS/JavaScript；
- 单元测试使用 Vitest，端到端测试启动真实 Restate Server 和独立 Service 进程。

## 模块边界

```text
src/domain/       Task、Archive、错误和状态转换
src/archive/      文件系统归档、摘要、Reconcile
src/restate/      Task/Archive Workflow 与 Projection Service
src/board/        Read API 和静态看板服务
src/cli/          命令提交与查询
public/           Board UI
tests/            unit / integration / e2e / review fixtures
```

领域层不依赖 Restate。Workflow 负责调用领域规则和 Durable Step；Board 只读取 Projection；CLI/Skill 只通过 API 发命令。

## 恢复设计

Archive 使用 `operation_id = archive/<task_id>/revision-<spec_revision>`。目录移动采用同一文件系统内的原子 Rename；每次执行前先观察 source/target 状态并 Reconcile。故障注入在 Rename 成功后、`ctx.run` 返回前终止 Service 进程，验证 Restate 重试时识别 target 已存在。

## 看板数据

Project Board Projection 由 Workflow 事件更新，包含 Task 卡片所需最小字段。看板不扫描目录推断 Runtime 状态；目录仅用于 Task Artifact 和归档历史。
