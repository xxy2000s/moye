# TASK-0032 Verification

> 状态：Accepted

| Requirement | Test | Evidence |
|---|---|---|
| REQ-0032-01/02/03 | Role/Phase、权限、Attempt/Evidence 单测 | `tests/unit/role-runtime-v2.test.ts`：5 tests；Fake 枚举、越权 Phase、跨 Attempt Evidence、终态复活均被拒绝 |
| REQ-0032-04/05/06 | 真实 Adapter、复用与 UNKNOWN/Reconcile E2E | `tests/e2e/role-runtime-v2.test.ts`：完整 Manifest 复用；Intent-only 不执行，统一 token 对账后才创建 Generation N+1；文件篡改拒绝 |
| REQ-0032-07 | 六类角色真实 OS 子进程矩阵 | 同一 E2E 真实 spawn 5 类主 Agent 的 7 个隔离 Phase和旁路 Observer，均保存 Session、工具 Event、Output、Manifest 与 Evidence；无 Fake/Mock Runner |

## 全库证据

- `npm run check`：31 test files / 174 tests；文档图谱 287 documents / 477 relations / 183 Markdown；
- `npm run test:e2e`：7 files / 22 tests；
- Knowledge Disposition：`none`。本 Task 的稳定恢复规则已写入 Architecture/CodeMap；未发现需要单独登记的 Finding、Pitfall 或 Backlog。
