# Incidents：故障事件与后续输入

本目录只记录真实发生的开发、测试或生产故障。Incident 是带有时间线、影响和处置过程的故障事件，不是通用“证据”目录，也不等同于一个 Bug。

## 命名

```text
YYYY-MM-DD-short-title.md
```

## 流程

1. 从 [template.md](./template.md) 创建 Incident；
2. 记录事实时间线，不推测未验证原因；
3. 确定影响、根因和修复；
4. 将 Bug 或改进项拆成一个或多个 Finding / Backlog Item；
5. 将普遍教训提炼到 Pitfalls；
6. 如改变架构或技术选择，创建 ADR；
7. 更新本索引和 `docs/graph.yaml`，关联 Backlog、受影响的 Architecture、Pitfall 和 Runbook。

不要为了演示文档体系创建虚构 Incident。
