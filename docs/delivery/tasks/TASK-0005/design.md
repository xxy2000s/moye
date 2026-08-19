# TASK-0005 Design

> 状态：Approved
> Spec Revision：1

## 边界

`AgentRunner` 接收已规范的 `AgentRunRequest`，只负责一次 Attempt 的 Agent 进程与 Artifact，不推进 Task 状态、不提交 Git、不执行 Gate。`FakeAgentRunner` 与 `CodexExecAgentRunner` 产生同一种 `AgentRunResult`。

```text
AgentRunRequest(run id + producer tuple)
        │
        ├── Fake script ─────┐
        └── codex exec --json├──> JSONL parser → Artifact bundle → Result
                            └──> stderr
```

Artifact 写入使用稳定目标和 `.pending` 文件；重放先验证现有 manifest 与内容摘要，完全一致才复用。真实 Codex 的认证和模型选择沿用本机 CLI 配置，本 Adapter 不读取或复制凭证。
