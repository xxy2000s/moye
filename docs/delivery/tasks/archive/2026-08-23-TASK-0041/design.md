# TASK-0041 Design

复用 `src/git/merge-effect.ts` 的 deterministic `commit-tree + update-ref <new> <old>` Effect，不实现第二套 Merge。Core v2 Verification Gate 生成只在当前 Workflow 调用栈内受信任的 Merge Request；Request、effectId 与 Result 都由 Git Effect 负责。

`ctx.run(local-merge-effect)` 同时创建 Request 和执行 Effect。若进程在 ref update 后退出，Restate 重放该 Step，Effect 首先用 marker、双 parent 与 target ancestry 对账，返回同一个 Merge Commit。Lifecycle 只接受非 `CONFLICT` 的真实 Receipt，禁止 candidate SHA 冒充 merge SHA。

首版沿用 Restate Step recovery，不新增人工 Merge reconcile 信号；人工信号只用于无法读取 Git facts 的 `UNKNOWN` 扩展场景，后续故障矩阵 Task 再验证边界。

真实 Task 运行时还修正四个输入/证据边界：Role Runtime 自身把逻辑路径解析为物理目录；Architect 只对语义等价的 scalar acceptance criterion 做数组归一化，其他 Artifact 仍由严格 Parser 校验；Failure Artifact 物理路径增加 Task namespace；Trusted Runner 的文件 Digest 使用原始字节 SHA-256，并在 Manifest 复用时重读验证。Final Review Prompt 明确只审 Candidate 和 Merge 前 Gate Evidence，目标 ref 更新由后续 Workflow Effect 执行。
