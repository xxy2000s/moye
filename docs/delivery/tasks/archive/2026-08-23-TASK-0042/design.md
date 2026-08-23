# TASK-0042 Design

成功与失败使用同一“业务 Closure 后独立 Archive Effect”不变量，但产物 schema 分开表达 outcome。成功路径在 Verification Gate 与真实 Merge Receipt都确认后，先由 Lifecycle Reducer冻结 `SuccessClosure`，再调用不推进主状态的 Archive Adapter。Adapter 以 `task/revision/closureDigest` 派生稳定 Effect ID，在 Task namespace 下写 pending/receipt；完整 Receipt 重放复用，Intent-only 或冲突内容停止，不能回到 Merge 前阶段。

历史停滞不修改 `CoreV2Workflow/<task_id>`。新增 keyed append-only recovery successor，从 Restate Admin 提供的 source Invocation fact、原 Projection digest 和 TaskAuthority 当前 chain head建立 Recovery Input。successor 不解释或重跑失败 command，只把原历史固定为 Failure Closure输入，执行独立 Archive Effect并发布自身 Projection。Authority 只允许一个 successor；CLI、Board 和 Trace 解析 successor，同时保留 source workflow/invocation引用。

首版 recovery 仅覆盖已经存在且能严格识别的 Core v2 journaled command failure，不是任意管理员“强制关闭”接口。无法证明 source、Projection 或 Authority一致时拒绝，不扫描目录、不改 Restate内部状态、不伪造 Agent/Test/Git事实。
