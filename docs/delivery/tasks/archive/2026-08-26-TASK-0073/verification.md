# TASK-0073 Verification

> 状态：Accepted
> 产品证据：[external-examples-acceptance.json](./external-examples-acceptance.json)

| Requirement | Execution | Result |
|---|---|---|
| REQ-0073-01/02 | RC tarball 安装后复制三个模板为独立 Git repo，执行各自测试 | Node 2 tests、Python unittest、Git diff check 全部 exit 0 |
| REQ-0073-03 | 全文件 source dependency audit + Manifest validate | 0 source/Document Graph link；conventional/none 均按模板返回 |
| REQ-0073-04 | `npm run acceptance:framework:examples` | 真实 tarball、CLI init、三个 validate/test 全通过，摘要 `sha256:041817…3827` |
| REQ-0073-05 | 三个示例 README | 包含 start/watch/open、页面下钻、data-preserving stop 和显式 purge 边界 |

本 Task 验证示例是可安装消费 fixture，不把 smoke 冒充多 Agent 故障矩阵；完整 Runtime 场景由 TASK-0074 执行。
