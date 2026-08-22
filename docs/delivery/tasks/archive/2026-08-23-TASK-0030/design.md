# TASK-0030 Design

`SealedTaskWorkflow/<task_id>` 是后续仓库自举 Task 的提交/关闭协议，不替代 Core v2 产品 Workflow。它先校验 Active package 与 Base，生成内容寻址 Seal Intent 并等待 durable promise。操作者将 Task package 更新为 `sealed`、写入 Intent ID、移动到日期 Archive 路径并创建唯一 Result Commit；随后 `seal` shared handler 只接受匹配 token 的 Commit Evidence并解析 promise。

恢复后的 run 从同一 promise 得到 Evidence，使用 `ctx.run` 只读验证 Git 和文档门禁；成功时生成 `CLOSED + ARCHIVED` Projection。由于最终 Commit 已包含 Archive package，Workflow 不执行 rename 或写 Manifest，不会产生需要第二个 Git commit 的反向变更。

任一 Seal 校验失败都形成可解释失败或返回到可修正的等待状态；UNKNOWN 先对账 Commit/refs，不能创建第二个 Result Commit。
