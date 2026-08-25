# TASK-0069 Design

> 状态：Approved

公共 SDK 只暴露值对象和执行边界：`PluginAdapterV1` 接收冻结的 `AdapterOperationContextV1` 与请求，返回内容寻址 Result；它没有 Task Projection、Reducer、Workflow Client 或状态命令。Descriptor 用枚举化 capability 描述能力，协商器对 API、kind 和 required capability 逐项 fail closed。

副作用模型分为 `NONE | IDEMPOTENT | RECONCILABLE`。`RECONCILABLE` 必须声明 `effect.reconcile` 并提供 reconcile handler；`UNKNOWN` 必须绑定 operation、idempotency key、intent digest 和 token。Contract Suite 以同一 operation 重放 execute/reconcile，检查稳定摘要、UNKNOWN token、Evidence 冲突和禁止能力。

内建 Adapter registry 只把现有真实实现及其能力登记为 bridge descriptor，不获得状态推进能力。W05 以后 owning Workflow 按 negotiated capability 调用 bridge，消费结果后仍由自己的 reducer 决定合法迁移。
