# TASK-0041 Verification

> 状态：Accepted

## 需求与证据

| Requirement | Test / Execution | Evidence | 结果 |
|---|---|---|---|
| REQ-0041-01/02 | Lifecycle + Merge factory unit；真实 Candidate 后创建双父 Merge | Candidate `c79abb3aa3332b326427ed6f8934b05cc7bedede`；Merge `6f944eb869f6123b10a0d976915bb919b04775db`；parents=`f937ab8... c79abb3...` | PASS |
| REQ-0041-03 | `update-ref` 后 Service exit 76，重启同 URI并重放原 Invocation | `mergeReceipt.outcome=ALREADY_APPLIED`；`reconciledAfterUnknown=true`；Receipt Digest `sha256:48cec48677226217971ee835c43aed66788b531e5ffc8864c51ca9542f547d26` | PASS |
| REQ-0041-04 | Merge Effect 既有 target drift/marker/parent/checked-out target 回归；Core v2 request gate | `tests/unit/verification-merge.test.ts` 与全库门禁 | PASS |
| REQ-0041-05 | Lifecycle/Trace/Board 展示真实 Receipt | Verification Gate `sha256:2bac034da84e0a8b0e6d41c614894c6b9046643654b627c1af3b4dadfd24997b`；Projection `sha256:e64a4d691c2ea4ac2f7170c19ac69ab6e5ee486f57e0be1e7a7fe8e03ae79eb4` | PASS |
| REQ-0041-06 | 真实 Codex + Restate + Git + npm test + worker exit | Runtime Task `TASK-CORE-V2-MERGE-UNKNOWN-005`；Invocation `inv_1bucrBJ0vHpE2HRWsoEOIrnJjQLl3E0Ng4` | PASS（Merge/Reconcile 范围） |
| REQ-0041-07 | 独立 Result Commit + Seal | Seal Intent `sha256:de6ef90dc07c96020335aa991ee0b378879834def6d45fe1be70cd8a0154ed8e`；Result/Receipt 在提交后填写于 Runtime | Pending until submit |

## 真实 Role 与 Test Evidence

| Phase | Attempt | Session | Evidence Digest |
|---|---|---|---|
| ARCHITECT | `...ARCHITECT.r1.g0` | `01a02d9f-6b19-72b1-aff4-6f28ce9e39c8` | `sha256:82d9a59431215d293f15c383b55acc19d04e027f8834e19d0fedc0fea8f3465a` |
| DESIGN_REVIEW | `...DESIGN_REVIEW.r1.g0` | `01a02da0-28d8-7ee3-a139-023b3d9c0fec` | `sha256:11122cd9ab4dc131d49e8b61f47769e40ec8175f23d6be8bc42bee5e1a0fffb8` |
| IMPLEMENTATION | `...IMPLEMENTATION.r1.g0` | `01a02da0-9590-7181-87fb-ca889aa1e7fb` | `sha256:c9fc99c24f8a1941afea9711c2d5b7f806e6e3ae266162aaf623b95250416eeb` |
| DOCUMENTATION | `...DOCUMENTATION.r1.g0` | `01a02da1-b1ce-7142-8ca0-e930d80c9717` | `sha256:660e8e0bac76c3de891515717328abbe0d260a05427ee7fbb711bf3cc27bd4ef` |
| TEST_PLAN | `...TEST_PLAN.r1.g0` | `01a02da2-898e-7041-a7b1-44b1d9772e81` | `sha256:66fb8bc044cb4cce2e97d9003d39f45708af69daebcfeb981c683e58c00c4474` |
| TEST_ASSESSMENT | `...TEST_ASSESSMENT.r1.g0` | `01a02da2-e88e-71c0-9de4-8fbeff3079e6` | `sha256:7e93b5c337bfb5b1e4c9fcf813a76897961c886320704e69ff4a28907a20cfdf` |
| FINAL_REVIEW | `...FINAL_REVIEW.r1.g0` | `01a02da3-46cb-7a90-94cf-a02248dafebd` | `sha256:0e158540548965c8c384464d7cbe9f010fe95ca73427cddc30de1b21b5d7f56d` |

Trusted Runner 执行 `npm test` 一次，exit code 0；Manifest Digest `sha256:675e073905d90bd407c1f7bdabc7c62f9dcac50005a18585c01b708deac15ad0`，stdout 原始字节 Digest `sha256:419c4fd14fceb37285bfcb73dba8b44aa3b2c0235746b2ac19342846507ba855`，stderr 空文件 Digest `sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`。

唯一性检查：七个 Role Phase 各一个 Attempt/Session；`git log --grep='Moye local merge TASK-CORE-V2-MERGE-UNKNOWN-005'` 只有一个 Commit；ref-update marker 只有一行；target ref 指向唯一 Merge。

Board：`http://127.0.0.1:3014/tasks/TASK-CORE-V2-MERGE-UNKNOWN-005`；Trace API 显示 `consistency=VERIFIED`、7 Attempts、0 Repair/Replan/Unknown。最终产品入口切换到 3000 后页面链接保持相同路径。

## 明确未通过本 Task 冒充完成的能力

- 成功 Projection 当前 `lifecycle.archive=null`，没有真实 Success Archive Receipt，已登记 Finding 与 BL-0047；
- `TASK-CORE-V2-MERGE-UNKNOWN-001/003/004` 的 journaled command failure 仍需 BL-0046 successor 合法归档；
- 本证据不代表其余十四类真实 Agent 故障矩阵已完成。
