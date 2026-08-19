# TASK-0002 Spec：Backlog 文档幂等同步

> 状态：Approved for bootstrap execution  
> Spec Revision：1  
> Backlog：[BL-0008](../../backlog/BL-0008.yaml)

## 目标

提供一个显式、批次校验且幂等的 CLI，将 Git 中的 `BL-*.yaml` 转换为运行时 `ProjectBoard` Projection。Web 查询继续只读取 Projection，不在请求路径扫描文件系统。

## Requirements

### REQ-0002-01：字段与枚举转换

- 校验文档 Schema、ID、标题、Kind、Status、Priority、Source 和 Resolution；
- 将 `id/source_refs/resolution.task_refs` 转换为运行时字段；
- 将小写枚举严格转换为大写运行时枚举，未知值必须拒绝。

### REQ-0002-02：批次原子性与幂等

- 所有文件转换成功后才能提交运行时；
- 同一批次不得包含重复 ID；
- ProjectBoard 在单次 keyed Object 调用中合并整批数据；
- 内容未变化时不得写入新的 Projection 状态。

### REQ-0002-03：源文件消失策略

- 默认策略为 `PRESERVE`；
- Projection 中存在、当前文档批次不存在的记录必须保留并在结果中报告；
- 本 Task 不提供隐式删除或清理策略。

### REQ-0002-04：CLI 与查询边界

- CLI 提供 `backlog sync`，支持目录、项目 ID 和 Restate Ingress 配置；
- CLI 返回读取、写入、未变化和保留记录摘要；
- Web `GET /api/board` 继续只读取 ProjectBoard Projection；
- `CONVERTED_TO_TASK` 条目继续由现有 Board 规则隐藏。

### REQ-0002-05：验证证据

- 单元测试覆盖转换、非法枚举、重复 ID、幂等合并和 Preserve 策略；
- 真实 Restate 集成测试证明同步后 Ready/Triaged 可见、Converted 隐藏；
- `npm run check` 和文档影响门禁通过。

### REQ-0002-06：真实自举关闭

- 在真实编码 Workflow 尚未完成前，允许 Goal Bootstrap 执行者提交实际 Result Commit、Verification 和 Docs Impact 引用；
- Runtime 必须明确记录执行方式为 `GOAL_BOOTSTRAP`，不得产生“Agent 已执行”的虚假事实；
- 缺少 Commit 或证据引用时禁止成功关闭；
- 证据使用 `task-artifact://<TASK-ID>/<artifact>` 稳定引用，由运行时解析 Active/Archive 实际路径，归档后不得成为悬空引用；
- `CLOSED` 后仍由独立 Archive Workflow 归档，Archive 不是普通 Pipeline Step。

## 非目标

- 不监听文件变化；
- 不自动删除 Projection 记录；
- 不实现 Agent、Worktree、Git Merge 或 Repair/Replan；
- 不让浏览器直接读取 Backlog YAML。
- 不把 Bootstrap Evidence 扩张为通用人工状态写入或完整编码 Workflow。

## 完成定义

BL-0002 至 BL-0007 可以通过显式命令同步到真实 ProjectBoard；重复命令不产生数据漂移；BL-0001 与 BL-0008 因为已转换而不出现在 Web Backlog 列；所有证据写入 Verification 后才允许关闭。
