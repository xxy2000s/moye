# TASK-0056 Spec：引入分级开发执行模式

> 状态：Accepted for implementation
> Spec Revision：1
> Backlog：[BL-0067](../../../backlog/BL-0067.yaml)

- `REQ-0056-01`：仓库必须把 `auto` 定义为默认选择器，把 `lite`、`standard`、`full` 定义为三个执行档位；
- `REQ-0056-02`：`lite` 只允许低风险、局部、易回滚且不改变契约或 Runtime 事实的工作，并免除 Context Route、Finding/Backlog/Task package、Docs Impact、Document Graph 和 Runtime Seal；
- `REQ-0056-03`：`lite` 仍必须检查 worktree、读取直接相关源码、执行定向验证，UI 变更必须真实浏览器验收，结束前执行 `git diff --check` 并报告证据；
- `REQ-0056-04`：`standard` 保留 Context Route、最小 Task、按影响更新文档、Docs Impact 与单 Result Commit，但不强制多 Agent 或真实故障矩阵；
- `REQ-0056-05`：`full` 用于 Core 状态机、持久化 Schema、外部副作用、Reconcile、权限安全、迁移、依赖与架构边界等高风险变更，保留完整任务与证据闭环；
- `REQ-0056-06`：Agent 必须在开始时声明所选档位和理由；执行中命中更高风险条件时只能升级，不能以用户指定低档位绕过安全门禁；
- `REQ-0056-07`：`performance` 只表示并行化等执行策略，`ultimate` 不作为规范档位；契约测试必须防止 AGENTS 与 Skill 漂移。
