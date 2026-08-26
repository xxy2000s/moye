# TASK-0080 Verification

> 状态：Accepted

## Requirement → Execution → Evidence

| Requirement | Execution | Result / Evidence |
|---|---|---|
| REQ-0080-01/02 | `SessionEvidenceSemanticsV1` unit matrix + Board resolver integration | Availability、Content、Binding、Limitation 由单一 Domain 函数输出；`COMPLETE/PARTIAL` raw state 均映射 `AVAILABLE`，真实缺口产生稳定结构化 reasons |
| REQ-0080-03/06 | legacy sentinel 精确 Digest 测试 + canonical 历史 Session | `TASK-RCV-20260826114418-01-ROLE-RECOVERY` Architect 原始 `PARTIAL + UNVERIFIED`、32/32 Event、零 parse/unknown/drop，派生 `AVAILABLE + COMPLETE + UNVERIFIED`；相同 error code 的非 sentinel 仍为 Content `PARTIAL` |
| REQ-0080-04 | `full/digest_only/redacted` 与 `NOT_EXPOSED` matrix | policy/provider omission 均保持 Content `COMPLETE`，分别进入 `NONE / OMITTED_BY_POLICY / REDACTED / NOT_EXPOSED` limitation；多重 limitation 顺序固定 |
| REQ-0080-05 | Pending/Reconcile/Unavailable/Failed/Integrity unit matrix | 五种 Availability 独立；不可读 Evidence 的 Content `evaluated=false`、Binding `NOT_APPLICABLE`，不制造完整性结论 |
| REQ-0080-07 | canonical API 前后只读核对 | Receipt `sha256:7b69b895…b2fb3`、Manifest `sha256:99576df3…34be8`、normalized `sha256:481dfdb8…fa581`、source `sha256:961505a7…8ba0` 保持不变；Evidence 文件 Digest `sha256:ab0aa402151650ebd0bc4c5d94a6041b3a5b7e17a940b0ae60a7fefada76a68e` |

## Executions

- `npx vitest run tests/unit/session-evidence-semantics.test.ts tests/unit/session-capture-effect.test.ts`：2 files / 8 tests passed。
- `npx vitest run tests/e2e/transcript-enrichment-restate.test.ts`：真实临时 Restate + Board，1 file / 3 tests passed；历史 API 端到端返回统一 `semantics`。
- `npm run check`：typecheck 通过，57 unit files / 315 tests passed；归档路径切换后 Document Graph 741 documents / 1137 relations valid。
- `ruby scripts/docs_graph.rb validate-impact --report docs/delivery/tasks/archive/2026-08-27-TASK-0080/docs-impact.yaml`：20 required reads / 58 reviewed impacts valid。
- `git diff --check`：通过。

## Review

- 写入侧 Transcript v1、Adapter、Receipt/Manifest parser 和 Digest 算法均未修改；新合同只在受管 Artifact 校验后的 Board read model 中派生。
- legacy exception 同时要求固定 code、scope 与两个已知 detail Digest，不能吞掉其他 `UNSUPPORTED_FORMAT/PARSER` 故障。
- Content 不读取 prompt completeness 或 raw `captureState` 作为捷径；Binding 与 limitation 无法冒充 data loss。
- UI 文案、操作建议与 error envelope 接入属于 TASK-0081，本 Task 不提前复制展示规则。

Evidence：[session-semantics-acceptance.json](./session-semantics-acceptance.json)。
