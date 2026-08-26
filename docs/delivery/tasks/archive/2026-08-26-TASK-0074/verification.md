# TASK-0074 Verification

> 状态：Accepted
> 统一 Evidence：[`framework-product-matrix.json`](./framework-product-matrix.json)
> Runtime Matrix Digest：`sha256:d65f253ba55f8bb00f8ab253706e23b6e4d54d5f6c7f2b0db8b59456942f8354`

## Requirement → Execution → Evidence

| Requirement | 真实执行 | 结果与关键 Evidence |
|---|---|---|
| REQ-0074-01 | Node Happy `TASK-ACCEPT-20260826013428-01-HAPPY` | `CLOSED/ARCHIVED/SUCCEEDED`；7 Role；1 次 `npm test`；Merge `8e8c3f1…` |
| REQ-0074-01 | Node Self Review Repair `TASK-ACCEPT-20260826014137-01-IMPLEMENTATION-SELF-REVIEW` | Generation 0 Finding；Generation 1 重跑 Documentation/Test/Final Review；唯一最终 Merge `8f124c4…` |
| REQ-0074-02 | Python Test Failure Repair `TASK-ACCEPT-20260826014912-01-TEST-FAILURE` | 真实 `python3 -m unittest discover -s tests` 先 exit 1、后 exit 0；旧 Test Manifest 不通过最终 Gate |
| REQ-0074-03 | Minimal Git Test UNKNOWN→NOT_APPLIED `TASK-RCV-20260826023652-01-TEST-NOT-APPLIED` | 错 token/冲突 Evidence 拒绝、相同 Evidence 幂等；`git diff --check HEAD` 只执行一次 |
| REQ-0074-04 | Minimal Git Repair Budget `TASK-GRD-20260826024315-01-REPAIR-BUDGET` | `CLOSED/ARCHIVED/FAILED_TERMINAL`；无 Merge；Failure Closure、Knowledge Disposition、Archive Receipt 完整；旧 Generation 拒绝 |
| REQ-0074-05、09 | Cross-version Role Recovery `TASK-RCV-20260826114418-01-ROLE-RECOVERY` | 旧 `9b6714e…` → 新 `2b78270f…`；Architect/Implementation/Final Review 三次真实中断；7 Role、1 Test、1 Merge；归档 Projection Digest 升级前后相同 |
| REQ-0074-06 | RC tarball/container clean install | npm `sha256:e9a9842…`；container `sha256:209f6ca…`；SBOM `sha256:8654b8b…`；clean public API/CLI/init/validate 通过 |
| REQ-0074-07 | 专用 acceptance Service 与 Invocation fail-fast | 首轮 403 Invocation 保留；修复后矩阵无需人工预配置完成，结束时恢复主 Service 注册 |
| REQ-0074-08 | 动态 test contract 与可恢复矩阵 | Node/Python/Git argv 与 Reviewer 同源；续跑复用前五个已归档场景，未产生重复 Agent/Test/Commit |

每个场景的 Attempt、Session、Run、Role Manifest、Candidate、Test Manifest、Gate、Closure、Archive 与页面链接保存在统一 JSON 和对应 Runtime Projection/Artifact 中。页面路径统一为 `http://127.0.0.1:3000/tasks/<task_id>`。

## 失败历史处置

- `TASK-RCV-20260826015759-01-TEST-NOT-APPLIED` 因旧 Harness 把 Minimal Git 验收文字硬编码为 `npm test`，真实 Reviewer 正确阻塞；它通过合法 successor 收敛为失败归档，不计为通过。
- `TASK-RCV-20260826024700-01-ROLE-RECOVERY` 的 Runtime 恢复最终成功，但临时 snapshot 被旧 Harness 清理，无法复验新 Service Commit；它保留为诊断历史，不计为升级通过。
- 修复后的场景均使用新 Workflow key；没有删除、覆盖或重新提交原 Task。

## 自动门禁

- `npm run acceptance:framework`：通过，Evidence Digest 如上。
- `git bundle verify service-upgrade-snapshot.bundle`：通过；bundle 包含新 Service Commit `2b78270f…` 与完整历史。
- `npx vitest run tests/unit/board-health.test.ts`：3 tests passed。
- `npm run typecheck`：通过。
- `ruby scripts/docs_graph.rb validate`：通过（文档收束前检查）。
- `npm run check`：通过；53 files / 298 tests passed，Docs Graph 通过。
- `npm run test:e2e`：通过；13 files / 35 tests passed，2 files / 2 tests 按既有环境条件 skipped。
- 最终 Docs Impact：在 Result Commit 前验证并记录最终结果。

## 结论与边界

TASK-0074 的外部项目产品矩阵 Accepted。它证明本地单 Restate 集群、真实 Codex、隔离 Git、受控本机测试和两版本 Service 的 Framework MVP 场景，不证明远程 Git Provider/PR、多 Daemon Lease、跨节点 Artifact Store、Auth/RBAC、多租户、生产 Sandbox、HA/SLO 或 Registry 发布已经完成。
