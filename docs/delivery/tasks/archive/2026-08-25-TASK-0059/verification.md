# TASK-0059 Verification

> 状态：Accepted

| Requirement | Evidence | 结果 |
|---|---|---|
| REQ-0059-01～06 | `tests/unit/codex-session-adapter.test.ts`：唯一 thread locator、stable snapshot、raw/normalized/Manifest、源移走后读取、幂等重放、坏行、超限、Session mismatch、符号链接、重复源、`digest_only` Prompt Digest 匹配 | PASS（5 tests） |
| REQ-0059-07 | `npm run acceptance:agent-sessions:codex` 真实 `codex exec` Role Run | PASS |

真实产品证据：

- Task / Attempt：`TASK-0059` / `TASK-0059.ARCHITECT.r1.g0`；
- Run：`sha256:f5172124a70d3550ebc23ccb6c2739aa572fc579184a75e460b9d674464f997d`；
- Provider Session：`01a03a0c-53fa-71c0-9ed2-4b528fb2fbec`；
- Role Manifest：`sha256:c8e71c743f591710069fe29bada14795f352d503ece12584d1911fd52e6c7521`；
- Prompt Envelope：`sha256:568203f353f52cc5fc9ca6d2c21743dd601d66afb901b55e49cdd52673208b9d`；
- Transcript Manifest：`sha256:823733c99450d8dff65e12e2c853b9a73f5404773543444fa276020828f9df24`；
- normalized：`sha256:7905d58c853731ab65e6ccdb2125fb60c5df05acc992d125b8dadaccaec2a60d`；
- exact-byte source：`sha256:f7e5abdcc915f3da3d3ae60f1882c2c1baa1f0886b244c0288b7a13968c3686e`；
- Timeline：Prompt 1、Assistant 4、Tool Call 2、Tool Result 2、System 25；
- Evidence Root：`/var/folders/b1/g0h9j9vd4356lc0n6h6gplz00000gn/T/moye-task-0059-codex-product-771zSn`（运行时本机证据，Git 仅保存 Digest 摘要）。

全库门禁：`npm run typecheck` 通过；`npm test` 通过（42 files / 249 tests）；`npm run test:e2e` 通过（12 files / 31 tests，真实 Codex 专用用例由显式产品命令执行）；`git diff --check` 通过。
