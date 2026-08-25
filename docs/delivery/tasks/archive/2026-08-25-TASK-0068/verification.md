# TASK-0068 Verification

> 状态：Accepted
> 验证日期：2026-08-25

## Requirement → Evidence

| Requirement | Evidence |
|---|---|
| REQ-0068-01 | `StartProjectTaskRequest` 只含 Manifest/目标/验收/可选 ID；Receipt 不含 Artifact Root 或 Workflow Input。 |
| REQ-0068-02 | `prepareProjectTask` 冻结 clean HEAD、target=base、test argv、Runner 和 `~/.moye/runtime` 外部 namespace。 |
| REQ-0068-03 | 修正版真实 doctor 的 manifest/git/git-clean/git-target/agent/test/artifacts/docker/restate/board 十项全部 PASS。 |
| REQ-0068-04 | Client `status/watch/taskUrl/trace` 与 CLI `task status/watch/open --print` 只读附着 owning Workflow。 |
| REQ-0068-05 | [framework-client-acceptance.json](./framework-client-acceptance.json)：`TASK-FRAMEWORK-20260825224122` 七个真实 Session、真实测试、Candidate、Merge、Gate、Closure/Archive 成功。 |

## 真实产品证据

- Task：`TASK-FRAMEWORK-20260825224122`；Invocation：`inv_18iBRMBeY1ii4Vi2ICWmfXxyUT7lDRpxZs`；
- Candidate `2e26be5123575f3fc3963e952472e00c2e8d68c8`；Merge `457fd545e12d4bb3cde7994899303cde6f9c897f`；
- Trusted Test Manifest `sha256:847067f8…d0ca`；Verification Gate `sha256:d2061fb1…0756`；Archive Receipt `sha256:43f15cbb…3d24`；
- 终态 `CLOSED / ARCHIVED / SUCCEEDED`，页面 `http://127.0.0.1:3000/tasks/TASK-FRAMEWORK-20260825224122`。

首轮 `TASK-FRAMEWORK-20260825223022` 暴露缺失 target ref；Merge 未重复，在 ref 恢复为 base 后原 Workflow 成功归档。它只作为 Finding 证据，不替代修正版通过任务。

## Commands

- `npm run typecheck`；
- `npx vitest run tests/unit/framework-client.test.ts tests/unit/project-manifest.test.ts`：2 files / 9 tests；
- `RESTATE_INGRESS_URL=... MOYE_BOARD_URL=... npm run acceptance:framework:client`：真实修正版通过；
- `npm run check`、Document Graph、Docs Impact、`git diff --check`：通过。
