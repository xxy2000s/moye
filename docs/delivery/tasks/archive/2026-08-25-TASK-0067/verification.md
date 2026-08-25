# TASK-0067 Verification

> 状态：Accepted
> 验证日期：2026-08-25

## Requirement → Evidence

| Requirement | Evidence |
|---|---|
| REQ-0067-01 | `schemas/project.schema.json` 与 `ProjectManifestV1` 覆盖全部冻结领域，版本为 1。 |
| REQ-0067-02 | `relativePath` + `resolveContainedPath` 拒绝 lexical/symlink escape；`argv` 拒绝 shell、破坏 executable、inline eval 和控制字符。 |
| REQ-0067-03 | 真实临时项目运行 `moye init`；首次成功、重复拒绝、`--force` 显式覆盖由单元测试验证。 |
| REQ-0067-04 | 真实 CLI `project validate` 返回 project/schema/api/plugin/digest/repository/policy。 |
| REQ-0067-05 | legacy v0 fixture 显式迁移并报告 `migratedFrom: 0`；未来版本稳定拒绝。 |
| REQ-0067-06 | `tests/unit/project-manifest.test.ts` 5 个场景全部通过。 |

## Commands

- `npm run typecheck`：通过；
- `npx vitest run tests/unit/project-manifest.test.ts`：1 file / 5 tests 通过；
- 临时目录真实 `npm run cli -- init`、`project validate`、重复 init 拒绝：通过；
- `npm run check`：通过；
- Document Graph 与 Docs Impact Gate：通过；
- `git diff --check`：通过。

## 剩余边界

Manifest 只形成消费级配置和 pre-dispatch 信任边界；W03 才会把它转换为真实 Core v2 Task，W04/W05 才会执行 Plugin 与 Documentation Policy。
