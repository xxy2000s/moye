# Tasks：Active 与 Archive

本目录直接包含所有 Active Task；已完成归档动作的 Task 放入 [`archive/`](./archive/README.md)。除 `archive/` 外，每个一级子目录都必须是一个稳定 Task ID。

```text
tasks/
├── TASK-0042/                        # Active：包括等待、执行、阻塞、验证和关闭中
│   ├── task.yaml
│   ├── spec.md
│   ├── design.md
│   ├── plan.md
│   ├── verification.md
│   └── docs-impact.yaml
└── archive/
    └── 2026-08-19-TASK-0041/         # 已归档，不再作为活动输入
```

不要为 `queued`、`blocked`、`verifying` 等 Runtime 状态创建目录。它们写入 `task.yaml` 和 Task Runtime Projection。

新建 Task 时复制 [`task.yaml`](../../meta/templates/task.yaml)。Task 目录的具体工件可以按复杂度裁剪，但 `task.yaml`、Spec Revision、验证结果和关闭结果必须可追踪。

## 当前 Active Task

| Task | 状态 | 目标 |
|---|---|---|
| — | — | 当前没有 Active Task；下一项由 Core v2 Roadmap 顺序创建 |

已完成任务从 [Archived Tasks](./archive/README.md) 查询。

## Archive Gate

Task 只有在进入业务终态后才能归档。归档至少需要确认：

1. 不存在 Active Attempt；
2. 外部副作用已经完成或对账；
3. Spec Revision 和验证证据已经冻结；
4. Merge、取消或终止结果已经记录；
5. Document Obligations 已处置；
6. Closure Report 已生成；
7. Worktree 已归档或清理。

归档失败只重试 Archive，不重新执行编码 Task。
