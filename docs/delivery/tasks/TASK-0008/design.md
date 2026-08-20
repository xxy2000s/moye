# TASK-0008 Design

> 状态：Approved  
> Spec Revision：1

## 体验结构

```text
任务结论（现在怎样、是否需要处理）
  ↓
中文 Pipeline（七个阶段与当前焦点）
  ↓ 点击/展开
Step + Attempt + Agent / Git / Verification 证据
  ↓ 高级排障
Workflow Ref + 精确过滤的 Restate Invocations + Artifact
```

Moye 负责把多个技术对象聚合成一个业务 Task 视图；Restate UI 继续负责 Invocation、Journal、Replay 和 State 排障。页面不新增状态写入口。

## Demo 数据流

```text
npm run demo
  → 创建 .moye-runtime/demo 下的隔离 Git Fixture
  → 冻结 TaskEnvelope 与验证命令
  → 调用 CodingTaskWorkflow/<task_id>
  → Fake Agent 在 Worktree 形成唯一 Result Commit
  → Verification Gate
  → Local Merge Effect
  → ArchiveWorkflow
  → ProjectBoard + Coding Trace
```

Demo 输入构造抽到可测试模块；脚本只负责编排端口、容器、服务、Fixture 和清理。所有 Git 命令使用 argv，不经 Shell。

## 展示语义

- `task_id` 是页面、Workflow、Attempt 和证据链的根关联；
- Pipeline 阶段状态从 Coding Projection 派生，不从日志猜测；
- 当前阶段优先展示“发生了什么”和“下一步是什么”；
- Agent Session、Commit 和验证命令只在相关阶段展开；
- Restate 与 Artifact 默认折叠，避免第一次使用时暴露底层噪声；
- UNKNOWN 或失败在对应阶段旁展示恢复动作，符合“错误附近给出下一步”的 UX 约束。

## Restate 深链

Trace 仍保存稳定 `restate://CodingTaskWorkflow/<task_id>`。浏览器链接使用 Admin Base URL 加 `target_service_name=CodingTaskWorkflow` 与 `target_service_key=<task_id>` 查询参数，只用于定位；业务状态仍以 Projection 为准。
