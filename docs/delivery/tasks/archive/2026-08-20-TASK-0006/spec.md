# TASK-0006 Spec：编码 Workflow、Verification 与本地 Merge

> 状态：Approved for bootstrap execution
> Spec Revision：1
> Backlog：BL-0002

## 目标

把 TASK-0003/0004/0005 的协议、Workspace Effect 和 AgentRunner 串成一个可执行的单 Agent 本地编码闭环：`CONTEXT → WORKSPACE → IMPLEMENT → VERIFY → MERGE → DOCS → CLOSED → ARCHIVE`。Workflow 是业务状态唯一写入者；所有外部操作必须有证据或 Reconcile。

## Requirements

### REQ-0006-01：唯一 Workflow 状态所有者

- Coding Workflow 顺序推进固定 Step，Adapter 只能返回结果；
- 每次 Step、Attempt、Result 和业务终态进入可序列化 Projection；
- Agent、验证器、Git Adapter 和 Board 不得直接推进主状态。

### REQ-0006-02：Verification Gate

- 只执行 Envelope 固定的 argv，显式 `shell:false`，每条命令保存 stdout/stderr/exit/duration/digest；
- 所有命令成功且验证时 Branch 仍指向同一 Result Commit，才生成 Verification Binding；
- 任一失败或 Commit 漂移禁止 Merge，并以明确失败终止。

### REQ-0006-03：本地 Merge Effect

- 只合并已通过 Gate 的确定 Result Commit，目标 Ref 与 Expected Base 必须匹配；
- 使用稳定 Effect ID，并用 target ancestry/HEAD 对账 Git 已完成但调用方未知的结果；
- 重复请求只能得到同一个 Merge Commit；冲突、Base 漂移和未验证 Commit 必须停止。

### REQ-0006-04：Docs 与关闭

- Merge 后生成 Docs Step Artifact；Fixture 可明确记录 `not_applicable`，不能跳过 Step；
- 只有 Workspace、Agent、Verification、Merge 与 Docs 证据齐全才进入 CLOSED；
- Archive 是 CLOSED 后独立动作，不因 Archive 重试而重新编码。

### REQ-0006-05：端到端证据

- 自动 E2E 用确定性 Fake Runner，在临时仓库仅合入一次 Fixture master；
- 验证失败 E2E 证明 master 不变；未知 Merge 结果 E2E 证明不重复合并；
- 运行一次真实 Codex Exec Fixture Smoke Test，只允许修改临时 Git 仓库，并保存 Session/JSONL/Commit/验证/Merge 证据。

## 非目标

- 不实现多 Daemon、远程 Git Provider、PR、Lease/Fencing 或完整 Repair/Replan；
- 不让真实 Codex 修改 Moye 主仓库；
- 本 Task 只提供最小 Projection，完整 Trace/故障注入看板留给 TASK-0007。

## 完成定义

纯模块和真实 Restate E2E 证明 Fake 成功、验证失败、Merge 幂等/未知结果；真实 Codex 在临时 Fixture 完成一次最小修改并只合入一次；全量回归、审查与文档门禁通过。
