# TASK-0058 Verification

> 状态：Accepted

Seal 首次提交因本行曾使用非规范机器状态而被拒绝；原失败证据保留，合法收敛见 TASK-0058R1 与 Runtime successor。

## Requirement → Evidence

| Requirement | 自动化证据 | 结论 |
|---|---|---|
| REQ-0058-01 | Finding、BL-0069、M1/M2 冻结计划与 Document Graph | 缺陷和后续消费路径已登记 |
| REQ-0058-02 | `session-transcript.test.ts` 的 Prompt Envelope、content policy、render binding 和 tamper cases | Prompt 内容、渲染身份、权限与隐私策略 fail closed |
| REQ-0058-03 | Locator publish/parse/stage fencing tests | 启动前不伪造 Session ID，阶段跳跃和 stale locator 被拒绝 |
| REQ-0058-04 | Timeline classification、source tuple order、canonical JSONL、prompt binding tests | 工具结果不冒充用户消息，Provider 源顺序稳定 |
| REQ-0058-05 | Manifest/Receipt/Intent cross-binding、raw/source、completeness、target ref tests | Task/Attempt/Run/Session/Provider/Artifact/Digest 严格绑定 |
| REQ-0058-06 | Capture Intent、UNKNOWN token、Reconcile Decision、Authority CAS/journal tests | Capture 未知只对账同一 operation，Transcript 无 Task authority |
| REQ-0058-07 | `role-runtime-v2.test.ts` 对每类真实 OS Role Run 的原 Manifest bytes、Digest 与 sidecar binding 检查 | 旧 `RoleRunManifestV2` 不修改且仍能建立精确绑定 |
| REQ-0058-08 | 16 个合同测试、243 个非 E2E 测试、4 个真实 Role Runtime E2E | canonical、隐私、stale、篡改和兼容路径已覆盖 |

## 已执行证据

- `npm run typecheck`：通过；
- `npx vitest run tests/unit/session-transcript.test.ts`：16/16 通过；
- `npx vitest run tests/e2e/role-runtime-v2.test.ts --maxWorkers=1 --no-file-parallelism`：4/4 通过；真实启动各主 Role/Phase 的 OS 子进程，并验证持久化 Manifest 可复用且未被 sidecar 改写；
- `npm test`：41 files / 243 tests 通过；
- `npm run test:e2e`：12 files / 31 tests 通过。

## 证据边界

本 Task 证明的是领域合同和对既有真实 Role Manifest 的兼容桥，不证明 Provider 原生 Session 已经完成产品集成。真实 Codex、Claude、运行时恢复、历史导入和 Board 展示分别由 M1-W02～W08 验收；Fake/fixture parser 结果不会被算作这些工作包的产品证据。
