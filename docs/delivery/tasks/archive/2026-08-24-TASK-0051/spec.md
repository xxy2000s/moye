# TASK-0051 Spec：收紧 Core v2 Recovery / Exception 画布分区

> 状态：Accepted for implementation
> Spec Revision：1
> Backlog：[BL-0062](../../../backlog/BL-0062.yaml)

- `REQ-0051-01`：Core v2 的 Recovery / Exception 背景不得继续横跨大半画布；其边界必须跟随 Repair、Reconcile 与 Failed 节点簇；
- `REQ-0051-02`：异常节点必须形成一条紧凑、可扫读的支线，Archive 分区与异常分区保持明确边界；
- `REQ-0051-03`：完整 Definition 的 19 个节点和 52 条合法边不得删除；只有 Runtime History 实际经过的边可以点亮；
- `REQ-0051-04`：桌面和 390px 窄屏必须可读，无节点重叠、分区裁切或新增横向溢出；
- `REQ-0051-05`：变更必须通过定向测试、真实 Runtime 浏览器验收、`npm run check`、`npm run test:e2e`、Docs Impact Gate 和唯一 Sealed Result Commit。
