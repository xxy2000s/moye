# TASK-0074 Design

> 状态：Approved

产品矩阵复用同一个 Core v2 owning Workflow 与真实 acceptance control，只把 fixture/test argv 参数化为 Node、Python 和 Git；control 只制造可观察缺陷或受控进程终止，不替代真实 Agent、Git 或 Trusted Runner。

跨版本场景把旧 Result Commit checkout 作为首个 Service 进程，Role manifest 边界终止后改由当前新 checkout 注册同一 Restate deployment endpoint。审计比较 Task 的 Role/Attempt/Session、Candidate/Test/Merge 和 Projection Digest，禁止仅改变版本字符串冒充升级。

统一入口自行启动带 acceptance 授权的专用 Service；场景在 Projection 创建前失败时同时查询 Restate Invocation，从而立即保留并报告真实拒绝。Node/Python/Minimal Git 的测试命令由同一个 argv 同时生成 Workflow Input、Reviewer 验收文字和 Evidence 校验，避免语言无关 fixture 被硬编码成 `npm test`。

跨版本运行在启动前把新版本冻结为独立 Git Commit/Tree/bundle。故障边界等待器同时观察 Service 进程和正式 Projection；若长 Role 已落盘 Manifest 后进入 `WAITING_RECONCILE`，只有 Run、Attempt 与 Manifest Digest 精确绑定时才提交 `CONFIRMED`，不会创建第二个 Role。矩阵支持显式复用已归档 Evidence，只重跑缺失阶段。
