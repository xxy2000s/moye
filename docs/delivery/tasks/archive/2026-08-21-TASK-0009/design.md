# TASK-0009 Design

> 状态：Approved  
> Spec Revision：1

## 边界

```text
CodingTaskWorkflow Projection ──> Trace Projection Builder ──> TraceSink
             │                           │                         │
             │                           │                         └─ OTLP HTTP ─> Phoenix（可选）
             │                           └─ stable trace/span ids
             └─ AgentRunResult ──> content-addressed JSONL / raw-api Artifact

Moye Board ── task_id ──> Trace API ──> Phoenix entry + allowlisted Artifact download
```

`TraceSink` 是诊断输出边界，不拥有状态。Workflow Projection 已经持久化的 Step、Attempt、Agent Result 和 Error 才是构建 Trace 的输入；OTLP 发送失败只记录诊断，不能反向把已经成功的 Task 改成失败。

## Trace 模型

- Task 使用稳定 Trace ID 作为查询关联，不创建跨天挂起的实时 root span；
- 每个 Pipeline Attempt 映射为有明确起止时间的短 Span，Agent Run 作为 IMPLEMENT 子 Span；
- 成功、确定失败与未知副作用映射为不同 Status/Attributes，但恢复决策继续由现有 Projection 派生；
- OTLP Sink 和 Noop Sink 共用同一不可变 Batch，方便本地 Receiver 测试与未来替换后端。

## Agent Adapter

Codex 和 Claude 都通过统一 ProcessRunner 边界执行。Adapter 只决定 argv、进程级 env 和原始流解析；Artifact Writer 继续负责稳定 Intent、原子落盘、摘要校验与未知结果处理。Claude Telemetry Env Builder 默认不记录提示词、回答、工具内容和 Raw API Body；深度调试显式开启时，Raw API Body 目录必须是当前 Run Artifact 的直接子目录。

## Board 安全

Artifact URL 不接受任意路径。服务先从 Coding Projection 中取 allowlisted `artifactRef`，再通过受管 Artifact Root/Run ID 解析目标；lexical path、realpath、普通文件和已记录 content digest 全部匹配后才响应。UI 仅渲染服务器返回的入口。
