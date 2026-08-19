# TASK-0001 Spec：可恢复 Task 生命周期、Archive 与项目看板

> 状态：Fulfilled / Archived  
> Spec Revision：1  
> 日期：2026-08-19  
> Backlog：[BL-0001](../../../backlog/BL-0001.yaml)

## 目标

实现首个可运行的 Moye 垂直切片：Task 由 Restate Durable Workflow 驱动，在关闭后通过独立 Archive 流程固化；Project Board 从查询投影展示真实状态；CLI 和 Skill 只提交命令、查询结果，不成为第二套状态机。

## 需求

### REQ-001：Task 领域状态

- Task 使用稳定 `task_id`；
- `CLOSED` 是业务终态；
- `archive_status` 独立表达 `NOT_READY / PENDING / ARCHIVED / FAILED`；
- 单个 Attempt 或 Archive Step 失败不能直接重开 Task。

### REQ-002：Durable Task 与 Archive Workflow

- Workflow 状态在服务进程退出后可恢复；
- 每个副作用步骤具有稳定幂等键或 Reconcile 路径；
- Archive 至少覆盖 Closure 校验、Manifest 冻结、目录移动、注册表更新和最终验证；
- Archive 失败只重试 Archive。

### REQ-003：未知目录移动结果

- `source 存在 / target 不存在` 时允许执行移动；
- `source 不存在 / target 存在` 时识别为已完成并继续；
- 两端都存在时比较内容摘要并 Reconcile；
- 两端都不存在时产生 Terminal Error；
- Worker 在移动成功但 Step Result 提交前退出后，重启不得重复产生归档包。

### REQ-004：查询投影与项目看板

- 提供 Backlog、Active、Archive Pending、Archived 四个主要视图；
- Task 详情至少展示状态、当前步骤、Attempt、Spec Revision、Backlog、Archive、最后事件和 Trace/结果引用；
- 看板只能查询 Projection 和提交 Command，不能直接修改状态。

### REQ-005：CLI 与 Skill

- CLI 提供 validate、route、status、create、close、archive、reconcile 和 graph 入口；
- 生命周期命令提交给 Workflow；
- 项目 Skill 调用 CLI/API，不自行解释或改写 Task 状态。

### REQ-006：可验证性

- 领域规则有单元测试；
- Archive 文件操作有幂等与冲突测试；
- Restate 集成测试覆盖服务重启；
- 端到端测试覆盖移动成功后 Worker 强制退出并恢复；
- 文档图谱、链接、Docs Impact 和 CodeMap 校验通过；
- 完成独立的安全性、恢复语义和边界审查。

## 非目标

- 真实 LLM 编码 Agent 和多 Daemon 调度；
- 生产级鉴权、多租户和权限系统；
- 完整 GitHub PR/Merge 集成；
- 用目录或 Ruby CLI 替代 Restate Task Runtime；
- 证明 Restate 是最终生产选型。

## 完成定义

所有需求都有测试或可重复演示证据；故障注入后 Task 得到唯一终态和唯一归档目录；看板显示恢复前后的状态；TASK-0001 自身文档影响完成并具备归档条件。
