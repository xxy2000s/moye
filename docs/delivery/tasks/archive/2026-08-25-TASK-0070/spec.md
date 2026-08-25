# TASK-0070 Spec

> 状态：Approved
> Milestone：M2-W05
> Backlog：[BL-0068](../../../backlog/BL-0068.yaml)

## 目标

将外部项目 Documentation Gate 实现为 `none | conventional | moye-doc-graph | custom` 四种确定性 Policy，使没有 Moye Document Graph 的项目也能闭环，并让最终 Docs Impact Artifact 来自真实策略执行证据而不是 Agent 自报。

## Requirements

- `REQ-0070-01`：Manifest 四种 policy 都映射为冻结 Workflow Input；旧输入未携带 policy 时保持 replay-compatible legacy 路径。
- `REQ-0070-02`：`none` 生成明确 `NOT_REQUIRED` Evidence，仍绑定 base/candidate/changed-files Digest，不接受 Agent 自报代替。
- `REQ-0070-03`：`conventional` 对 Git diff 执行确定性规则；产品代码变化但没有 README/docs/CHANGELOG/SECURITY 等文档变化时形成 Blocking Finding。
- `REQ-0070-04`：`moye-doc-graph` 通过受控 argv Runner 执行项目自身 Graph 校验；`custom` 只运行 Manifest 已验证 argv/cwd，保存 exit/stdout/stderr Digest。
- `REQ-0070-05`：Policy Evidence 内容寻址、幂等落盘并转换为 Candidate-bound Docs Impact Payload；失败进入既有 REPAIR，不绕过 Documentation、Test 或 Final Review。
- `REQ-0070-06`：单元、Core 集成与无 Moye docs 项目真实 Workflow 验收证明 policy 生效。

## 非目标

- 不允许 custom command 使用 shell、越界 cwd 或直接推进 Workflow。
- 不在本 Task 发布容器/包或实现远程文档服务。
