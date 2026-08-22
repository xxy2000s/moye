# Delivery：从 Backlog 到归档 Task

当前长期执行序列见 [Core v2 Delivery Roadmap](./core-v2-roadmap.md)。它只记录交付编排和进度；当前架构事实仍由 Architecture、ADR、代码和测试证明。

Delivery 管理已经进入研发交付链路的工作对象：

```text
Sources
  → Backlog
  → Active Task
  → Closed Task
  → Archived Task
```

- [Backlog](./backlog/README.md) 是经过去重、分类和初步澄清，但尚未进入执行生命周期的工作需求；
- [Tasks](./tasks/README.md) 保存当前 Active Task 和归档历史；
- Backlog 不是 Task；创建 Task 时显式记录一个或多个 `backlog_refs`；
- `Closed` 是业务终态，`Archived` 是业务关闭后的存储和固化动作，两者不能混为一谈。
