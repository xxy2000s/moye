# TASK-0070 Verification

> 状态：Accepted
> 验证日期：2026-08-25

| Requirement | Evidence |
|---|---|
| REQ-0070-01 | Client 映射四种 Manifest policy；Core 输入字段可选，undefined 明确保留 legacy replay command sequence。 |
| REQ-0070-02 | `none` 单元与真实任务均生成 Candidate-bound `PASSED / NOT_REQUIRED` Evidence。 |
| REQ-0070-03 | conventional 测试覆盖产品代码无文档 BLOCKED、同步 README PASSED。 |
| REQ-0070-04 | Graph/custom 通过 `shell:false` Runner；保存 argv/cwd/exit/stdout/stderr Digest，拒绝 shell、inline eval 与越界 cwd。 |
| REQ-0070-05 | Evidence 验证 clean HEAD=Candidate、幂等写入；Core BLOCKED 复用既有 REPAIR，PASSED 转换为 Docs Impact。 |
| REQ-0070-06 | [documentation-policy-acceptance.json](./documentation-policy-acceptance.json)：无 Document Graph 的真实七 Role Task 最终 `CLOSED / ARCHIVED / SUCCEEDED`。 |

真实 Task `TASK-DOCS-POLICY-20260825231609`：Candidate `a99b8c7…`，Merge `f00161d…`，Policy Evidence `sha256:4c98f5ca…`，Trusted Test `sha256:1f73532d…`，Gate `sha256:cee64f24…`，Archive `sha256:95c2e03c…`；页面 `http://127.0.0.1:3000/tasks/TASK-DOCS-POLICY-20260825231609`。

验证命令：`npm run typecheck`、`npx vitest run tests/unit/documentation-policy.test.ts tests/unit/framework-client.test.ts tests/unit/project-manifest.test.ts`（16/16）、`npm run acceptance:framework:docs`、`npm run check`、`npm run test:e2e`、Document Graph/Impact、`git diff --check`。
