# TASK-0047 Spec：Core v2 真实矩阵证据完整性与可重复性审计

> 状态：Accepted for implementation
> Spec Revision：1
> Backlog：[BL-0043](../../../backlog/BL-0043.yaml)、[BL-0051](../../../backlog/BL-0051.yaml)

- `REQ-0047-01`：提供显式输入的矩阵审计命令，只接受调用方列出的 suite summary，不扫描目录挑选“最新成功”；
- `REQ-0047-02`：逐场景校验 `PRODUCT_ACCEPTANCE`、Task/Workflow/Invocation、Revision/Generation、Role Attempt/Session/Event/Manifest、Candidate/Checkpoint、Trusted Test、Gate、Knowledge、Closure、Archive、Projection 与页面链接；
- `REQ-0047-03`：根据场景预期区分成功与确定失败，二者都必须 `CLOSED + ARCHIVED`，失败场景必须有原阶段/原因/Attempt/Session/Failure Closure；
- `REQ-0047-04`：审计时从真实 Restate Workflow 与 Board API 重新查询 Task，比较 outcome/archive/Projection 和 TaskAuthority owner，不以 summary 自证；
- `REQ-0047-05`：对真实隔离 Git 仓库验证 Candidate/Checkpoint/Merge 对象与 ref，按场景检查 Agent/Test/Commit/Merge 不重复和旧 Evidence 失效约束；
- `REQ-0047-06`：输出 Requirement → Scenario → Test Case → Execution → Evidence 的内容寻址统一报告；缺字段、重复 ID、冲突状态或不可查询 Runtime 必须非零退出；
- `REQ-0047-07`：修正文档图中已归档 TASK-0046 的 path/status/index 漂移，并让审计覆盖归档图谱一致性；
- `REQ-0047-08`：通过单元测试、`npm run check`、`npm run test:e2e`、Docs Impact 与唯一 Result Commit Seal。

本 Task 建立审计与重复性门禁，不把历史低层 Fake/Adapter 测试列入产品矩阵，也不替代 TASK-0048 的全套真实 Agent 新 Task 复跑。
