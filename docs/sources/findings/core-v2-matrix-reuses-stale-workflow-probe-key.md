# Core v2 矩阵复用 Workflow 探针 key 后被旧 Deployment 钉住

> 文档类型：Finding  
> 状态：Confirmed  
> 发现日期：2026-08-23

TASK-0048 的完整真实矩阵在 Recovery suite 结束后重新注册父 Service 时，重复调用 `CoreV2Workflow/__matrix-probe__/status`。这个 key 已经由 Recovery 临时 Service 建立 Restate Workflow 实例；临时 Service 停止后，同一 key 的后续调用仍路由到原 Deployment，于是父 orchestrator 等待已停止的端口并中断 Guard suite 的衔接。

已经完成的十二个真实场景及其 Task、Event 和 Evidence 均保持原样。现场通过在原端口恢复兼容 Service 使既有 invocation 合法完成，没有重提 Workflow key。永久修复是每次注册生成新的、可追踪的 probe Task ID，禁止跨 Deployment 复用 Workflow identity。
