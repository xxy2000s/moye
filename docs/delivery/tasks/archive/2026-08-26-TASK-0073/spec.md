# TASK-0073 Spec

> 状态：Approved
> Milestone：M2-W08
> Backlog：[BL-0068](../../../backlog/BL-0068.yaml)

## 目标

交付 Node/TypeScript、Python 和最小通用 Git 三个可复制的独立外部项目示例；每个示例只消费 npm tarball/CLI、公共 Manifest Schema 与 Runtime HTTP 边界，不 import 或链接 Moye 源码。

## Requirements

- `REQ-0073-01`：三个示例均包含最小业务代码、真实测试、`.moye/project.yaml` 和从零操作说明。
- `REQ-0073-02`：Node 与 Python 示例分别使用真实语言测试命令；Minimal Git 不要求语言工具链。
- `REQ-0073-03`：示例不依赖 Moye `docs/graph.yaml`，Documentation Policy 分别展示 conventional/none 的合法边界。
- `REQ-0073-04`：统一自动化从 RC tarball clean install，复制为三个隔离 Git repo，执行 Manifest validate、测试和消费级 CLI smoke。
- `REQ-0073-05`：说明 Runtime 启动、Task start/watch/open、页面下钻、停止与数据保留/清理，不要求用户构造 Workflow Input。

## 非目标

- Repair/Reconcile/失败归档/跨版本升级的真实矩阵由 TASK-0074 执行，本 Task 不重复宣称。
