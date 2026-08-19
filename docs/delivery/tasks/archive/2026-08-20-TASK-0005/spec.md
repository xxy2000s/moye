# TASK-0005 Spec：AgentRunner 与 Codex Exec Adapter

> 状态：Approved for bootstrap execution
> Spec Revision：1
> Backlog：BL-0002

## 目标

定义可替换的 AgentRunner 边界，提供确定性 Fake Runner 供自动化测试，并实现以 argv、`shell:false` 调用 `codex exec --json` 的 Adapter。一次运行必须留下可独立审计的 JSONL、Session ID、最终消息、退出码、耗时和日志 Artifact。

## Requirements

### REQ-0005-01：稳定 Agent Run 请求

- 请求绑定 Task、Spec Revision、Step、Attempt、Workspace、Prompt 和 Artifact Root；
- Workspace 必须是真实 Git top-level，Artifact 目标只能位于受管 Root 的 Attempt 直接子目录；
- Run ID 确定生成，JSON Roundtrip 依赖外部 Expected ID 校验。

### REQ-0005-02：可替换 Runner 与确定性 Fake

- `AgentRunner` 不依赖 Workflow 或具体 Agent 实现；
- Fake Runner 按固定 Script 产生 JSONL Event、Session、最终消息和退出结果；
- 相同 Run 重复调用复用完全匹配的 Artifact，冲突内容必须停止，不能覆盖。

### REQ-0005-03：Codex Exec Adapter

- 通过 `codex exec --json --sandbox workspace-write --cd <workspace> <prompt>` 调用当前本机 CLI；
- 使用 argv 与 `shell:false`，不拼 Shell 命令；捕获 stdout JSONL 与 stderr；
- 不使用 `--skip-git-repo-check`，不直接作用于 Moye 主仓库。

### REQ-0005-04：Event 与结果校验

- JSONL 每个非空行必须是对象；首个唯一 `thread.started` 提供 Session ID；
- 最后一个完成的 `agent_message` 是最终消息；记录 `turn.completed` 或失败事件；
- 进程退出码、Signal、开始/结束时间和 Duration 必须一致，非零退出不伪装成功。

### REQ-0005-05：Artifact 真实性

- 原始 stdout JSONL、stderr log、final message 与 manifest 原子持久化；
- Manifest 固定各文件的 SHA-256、Producer Tuple 和 Run Digest；
- 反序列化结果必须结合外部 Expected Digest，并重新验证 Artifact 内容摘要。

## 非目标

- 本 Task 不把 Runner 接入 Restate Workflow；
- 不实现 Verification Gate 或 Merge；
- 自动化测试不调用真实 Codex；真实 Fixture Smoke Test 留给 TASK-0006；
- 不支持 Session Resume、多个 Agent 或远程执行。

## 完成定义

Fake Runner 测试覆盖成功、失败、Malformed JSONL、重复执行、Artifact 冲突、路径逃逸和篡改；Codex Adapter argv 通过受控进程夹具验证；全量测试和文档门禁通过。
