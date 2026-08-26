# TASK-0083 Verification

> 状态：Accepted

## Requirement → Execution → Evidence

| Requirement | Execution | Result / Evidence |
|---|---|---|
| REQ-0083-01/02 | 固定映射的 `scripts/m3_acceptance.ts` + canonical Runtime 只读查询 | TASK-0077～0082 六个 Result Commit 的唯一父提交、`CLOSED / ARCHIVED / SUCCEEDED`、Intent/Package Digest 全部匹配；报告 `sha256:f4da0e57735b69e7e1271eec5b3f6d6a8c15897b8b7864a082457e5fd4ee74e8` |
| REQ-0083-03 | 当前源码临时 Board + W02 固定 Receipt | 开放列表精确为 BL-0004/5/6/7/83，BL-0031 不可见；batch `98457bb9ead7d73f657f4cd00391590e2b3e8ff49aa86162b5cf12caad49b955`，Receipt file `sha256:7240ec22f1c4b19c4a8b57a0ad0bfaf797a3cf7a44bca1a4e2bd5bd3aeadf4d5` |
| REQ-0083-04 | 固定历史 Task/architect Run 的实时 Session API | 32/32 events，`AVAILABLE + COMPLETE + UNVERIFIED + NONE`；Receipt `sha256:7b69b895…b2fb3`、Manifest `sha256:99576df3…34be8` 不变 |
| REQ-0083-05 | OS 临时目录重新 `npm pack`、clean install 与 scaffold 矩阵；固定 W06 权威 Task | 本轮 package `sha256:d3a64a58f389c165dca802dbb3e06a1eb27fe2883efccd6f2103117a79b0c54b`，scaffold `sha256:8a32525e…27fa`，Evidence `sha256:e537ea96bd67faf61532902493b2c319e0dd8d453ee79fa2dc56df11790d8f49`；权威 Task `TASK-SCAFFOLD-20260826191825` 仍为 `CLOSED / ARCHIVED / SUCCEEDED` |
| REQ-0083-06 | Playwright 真实 Chromium，当前源码 Board 1440×1000 / 390×844 | Backlog problem/source/Evidence、Session 四维/32 events/高级诊断、Escape/焦点、响应式、断网安全建议与恢复全部通过；正常 console error 0、Runtime 写 0 |
| REQ-0083-07 | unit/typecheck、真实 Restate E2E、Document Graph/Impact、diff | `npm run test:e2e` 13 files passed / 2 skipped，36 tests passed / 2 skipped；最终 `npm run check` 与文档门禁结果见 Executions |
| REQ-0083-08/09 | sealed-result-commit 两阶段交接 | Base、Intent 与 Archive path 已冻结；唯一 Result Commit 后才构建/注册 canonical Deployment、切换 3000 并 submit Seal，Deployment Receipt 是 Commit 外 Runtime 事实 |

## Executions

- 首轮完整 `npm run test:e2e` 暴露 Demo 仍提交旧 Backlog 形状；保持 W01 严格 Runtime 合同，修复 Demo v2 payload。随后真实 Demo E2E 暴露旧测试假设 Agent Dialog 紧邻 Task Detail，改为断言新增 Backlog Dialog 的真实 DOM 顺序。
- `npx vitest run tests/e2e/demo.test.ts`：修复后 1/1 passed。
- `npm run test:e2e`：最终 13 files passed / 2 skipped，36 tests passed / 2 skipped；真实隔离 Restate 容器自动清理。
- `npm run acceptance:m3`：六个前置 Task、五个 Backlog、固定历史 Session、packed scaffold 与 W06 权威 Task 全部通过；临时 Board 未注册，外部 fixture 位于 OS 临时目录。
- Playwright CLI：当前源码临时 Board 3033/55930，只读连接 canonical 50889；六张截图和结构化结果见 `browser-acceptance.json`，临时 endpoint 已停止。
- `npm run check`、`ruby scripts/docs_graph.rb validate-impact --report docs/delivery/tasks/archive/2026-08-27-TASK-0083/docs-impact.yaml` 与 `git diff --check`：Result Commit 前最终通过。

## Review

- 聚合器只消费显式常量与固定路径；没有按目录、mtime 或“最新成功”选择证据，没有提交 Workflow 或写 Projection。
- 当前源码 Board 未注册到 canonical Restate；浏览器与 API 复核只读。旧 Session 的 Manifest、Receipt、normalized/source Artifact 和所有 Digest 均未改写。
- Demo 修复补齐 v2 必需字段，没有放宽 Parser、未知字段、ownership 或 Digest 校验；测试维护反映真实 Dialog 层级，不删除产品断言。
- packed scaffold 重跑使用本地 tarball，不代表 npm/GitHub/container Registry 已发布；Auth/RBAC、远端 Artifact/Git Provider、多 Daemon Lease/Fencing 仍是明确限制。
- 部署只替换无状态 Service；canonical Restate 数据与未经只读审计的历史 endpoint 不删除。Result Commit SHA、Deployment ID 和最终 Runtime Receipt 在 Commit 后由 Seal/Deployment 事实记录。

Evidence：[M3 product acceptance](./m3-product-acceptance.json)、[scaffold rerun](./m3-scaffold-rerun.json)、[browser acceptance](./browser-acceptance.json)、[Backlog desktop](./browser-backlog-desktop.png)、[Session desktop](./browser-session-desktop.png)、[Session network failure](./browser-session-network-error.png)。
