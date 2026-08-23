# Core v2 Observer 验收超时早于 Session 证据产生

> 文档类型：Finding  
> 状态：Confirmed  
> 发现日期：2026-08-24

TASK-0048 首个 Observer/Knowledge 故障验收把真实 Codex 超时设置为 1 秒。进程确实被受控终止，Role Intent、失败 Attempt、失败 Manifest、空 Events Digest、`deferred` Knowledge Disposition、成功主 Closure 和 Archive 均已持久化；但 Codex 尚未来得及输出 `thread.started`，因此没有 Session ID 或 Agent Event。产品状态机没有被阻塞，验收器却要求失败 Manifest 必须同时包含 Session/Event，最终在产品 Task 已归档后失败。

超时前没有收到外部 Session ID 是合法事实，不能伪造。为覆盖“真实 Agent 已建立 Session 后超时”的产品验收，Guard 场景改用 10 秒受控超时，并以新 Task 重跑；旧 Task 和空 Events Digest 原样保留。
