# TASK-0020 Design

## 状态所有权不变

`CodingTaskWorkflow` 和 `TaskWorkflow` 仍是各自业务 Projection 的唯一写入者。新增 State Machine Trace Builder 只接受深冻结/只读 Projection，输出定义与历史；Board API 和浏览器不拥有转换命令。

## Definition 与 History 分离

- `definition`：代码版本明确支持的节点和合法边，边带 `normal | repair | failure | archive` 分类；
- `history`：只从有序 Domain Event 生成，每条记录保留 sequence、event type、from、to、time 和 detail；
- `current`：从 Projection 的主状态、currentStep 与 archiveStatus 得到，并标明来源；
- `executions`：归一化 StepAttempt、Agent Run 和 Review Run，保留 producer 与证据引用。

静态 Definition 不能证明某条边发生过；只有 History 中存在对应 Event 才标为 traversed。

## Coding Workflow 事件修正

真实 Implementation 完成后立即结束其 Attempt；Verification 在命令执行前进入并在结果后结束；Review 在模型调用前进入。Blocking Finding 后创建新的 IMPLEMENT Generation N+1，完成后重新 Verification 和 Review。Projection 保存 Agent Run、Checkpoint、Verification 和 Review 历史，不能只保留最后结果。

## 页面

详情顶部先展示“Runtime 状态机”，包括当前主状态、Archive 状态、实际路径和可用分支；其后才展示 Attempt/Evidence 和技术诊断。通用 Task 使用自己的 Event→State 映射。Web 创建表单从首页移除，避免把任务入口误解为闭环证据；已有 API 可保留给 CLI/自动化。

## Codex Git 写入边界

受管 Worktree 的 `.git` 是指向原仓库 common dir 的文件。`workspace-write` 只放行 Worktree 会让内容修改成功但 commit 失败。`AgentRunRequest` 已通过 `realpath` 和 Git top-level 校验固定 `workspaceGitCommonDir`，Codex argv 用 `--add-dir <workspaceGitCommonDir>` 只增加该受信 Git metadata 根；仍保持 `workspace-write`，不使用全盘写权限。
