# TASK-0082 Verification

> 状态：Accepted

## Requirement → Execution → Evidence

| Requirement | Execution | Result / Evidence |
|---|---|---|
| REQ-0082-01/02/06 | public/internal CLI unit + 真实 `npm pack` 安装 | `init --docs standard` 默认 plan、`--apply` 写入；普通 init 不变；tarball Digest `sha256:52ac1a1b7538fb95e2edbb802c4198b45299e538cdf365db39517a4895a8db95`，14 targets、help 与双入口同语义 |
| REQ-0082-03/04 | 仓库外 blank/occupied/symlink/concurrent 临时 Git 项目 | blank Digest `sha256:8a32525eb2628e9bbb767adc3ea020d22a073d11d9d769954691b2a1827027fa`；重复执行零 create；README/docs 冲突 exit 2 且原 Digest 保持；`--force` exit 1；symlink 外部写入 0 |
| REQ-0082-05 | 生成 validator + Documentation Policy env unit | allowlist 的 12 个受管文件通过；路径、symlink、size/Digest 漂移拒绝；Runner 注入冻结 Base/Candidate，Evidence 顶层继续作为持久化事实 |
| REQ-0082-07 | `acceptance:framework:scaffold` | OS 临时目录中 pack/install/plan/apply/replay/conflict/symlink/project validate/docs validate/clean Git 全部通过；Evidence `sha256:1435fc0e8cf7d4574d9611a4dfc7ec5dc3634dbe1ee685f3e43c1f9bb1fae442` |
| REQ-0082-08 | 临时真实 Restate 1.7.4 + 当前 Service + 安装后的 tarball CLI | `TASK-SCAFFOLD-20260826191825` 唯一收敛为 `CLOSED / ARCHIVED / SUCCEEDED`；custom Policy `PASSED`，Evidence `sha256:bc169a90ef2a175d11ef770c725ed2dfcc718f27b33159afc07feec65fbdbeee`；Task Evidence `sha256:85f7b65ff79c3c3b43b5416595d306b9adad8e100565eba6ef02de907d93155b`；bundle `sha256:c5944bed407c94450a8c273ee35155a6f4b71afa0d679292fe3f70cb95f1bace` |

## Executions

- `npx vitest run tests/unit/documentation-scaffold.test.ts tests/unit/documentation-policy.test.ts tests/unit/project-manifest.test.ts`：3 files / 19 tests passed。
- `npm run acceptance:framework:scaffold`：真实 pack/install 与外部 Git 项目矩阵通过；package、blank、occupied、symlink 和 Digest 事实见 `scaffold-package-acceptance.json`。
- `npm run acceptance:framework:scaffold:task`：权威最终运行使用临时真实 Restate/Service，真实七角色、Trusted Runner、Documentation Policy、Final Review、Closure、Archive 通过；Trace Digest `sha256:968b052fad092affb477f568b65653d082fb50cec844f71c445b4d3cd150db30`。
- 前一轮最终模板运行 `TASK-SCAFFOLD-20260826190530` 已在真实 Design Review 后 Replan 并成功归档，但验收收集器只枚举 revision 1，未生成摘要；原始 `scaffold-task-final-trace.json` 保留。收集器随后改为按冻结预算枚举 revision/generation，权威重跑证明修复；这不改变产品 Runtime 状态或外部项目事实。
- `npm run check`：typecheck 通过，58 unit files / 322 tests passed；Document Graph 760 documents / 1166 relations valid。
- `ruby scripts/docs_graph.rb validate-impact --report docs/delivery/tasks/archive/2026-08-27-TASK-0082/docs-impact.yaml` 与 `git diff --check`：Result Commit 前通过。

## Review

- 脚手架只在显式 opt-in 时运行；计划先完整分类，apply 只用 exclusive create，冲突、symlink、未来版本和不同字节均 fail closed。
- Scaffold Manifest 最后写入并绑定受管文件；项目 validator 不扫描、不迁移、不补写，且 Candidate 代码变化必须有文档变化。
- Documentation Policy 仍由 owning Workflow 执行，新增 env 仅传递已冻结 Commit；没有新建隐式状态机、Projection 写入口或可重试外部副作用。
- 三轮真实验收都位于 OS 临时目录并使用独立真实 Runtime；结束后临时容器、Service 和项目已清理，Moye 仓库只保存摘要、Trace 与 Git bundle。

Evidence：[package acceptance](./scaffold-package-acceptance.json)、[authoritative task acceptance](./scaffold-task-authoritative-acceptance.json)、[authoritative trace](./scaffold-task-authoritative-trace.json)、[first task acceptance](./scaffold-task-acceptance.json)、[replan trace](./scaffold-task-final-trace.json)。
