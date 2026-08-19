# Sources：工作输入源

Sources 保存尚未直接成为执行 Task 的输入。它们可以触发 Backlog，也可以只用于参考、分析或历史回溯。

```text
Brainstorm ─┐
Finding ────┤
Incident ───┼──> Backlog Item ──> Active Task
Research ───┤
Reference ──┘
```

## 类型

| 类型 | 目录 | 作用 | 是否直接约束实现 |
|---|---|---|---|
| Brainstorm | `brainstorm/` | 未收敛需求、假设和开放问题 | 否 |
| Finding | `findings/` | Bug、缺陷、异常现象和可复现问题 | 否，先进入 Backlog |
| Incident | `incidents/` | 一次真实故障及处置过程 | 否，可拆出多个 Backlog |
| Research | `research/` | 基于资料和实验形成的内部分析 | 否，可支持 ADR |
| Reference | `references/` | 外部文档、论文、仓库等资料登记 | 否，只作为参考来源 |

Source 不因被消费而删除。消费方通过稳定 ID 建立 `derived_from`、`creates_backlog`、`informs` 等关系，并记录未解决部分。
