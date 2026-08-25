# TASK-0054 Design

> 状态：Accepted

## 统一视图模型

三类 Trace 先归一化为只读 `Execution Ledger`：

- `actors`：系统 Workflow 或真实 Role / Agent Session；
- `deliverables`：Lifecycle Artifact、技术 Artifact、Result Commit、Task Package 与 Archive；
- `bindings`：Revision、Generation / Attempt、Session、Candidate 与 producer phase；
- `details`：摘要、完整技术标识和 Agent Events 入口。

归一化只发生在浏览器内，不写回 Projection，也不从标题推断不存在的 Agent。

## 信息层级

复杂任务默认使用桌面主从布局：左侧为 52–60px 高的角色行，右侧只展示一个选中角色的详情和直接交付物。完整 Artifact Register 与 Coding Journey 使用 disclosure 按需展开。长 Session / Artifact ID 与 Digest 放进“技术标识”，默认只显示短引用。

简单任务不使用空状态，而显示单个系统执行摘要：Workflow kind、Result Commit、Task Package 和 Archive 是真实系统交付物；`无 Agent Session` 是执行模式说明，不是缺失数据错误。

关联链不属于角色主信息，移动到“高级诊断”。画布继续负责完整 Workflow 流程，本 Tab 只回答“谁执行、结论是什么、交付了什么”。

## 响应式与可访问性

桌面为 `minmax(240px, .32fr) + minmax(0, 1fr)`；窄屏折叠为单列，并让角色选择器横向滚动。角色选择使用嵌套 ARIA tablist / tab / tabpanel、可见焦点和 44px 最小触控高度。自动刷新保留同一 Task 的角色选择；角色消失时回退首个真实角色。

Tab 内统一使用 14px 标题、12–13px 主信息、12px 正文和 10–11px 技术元信息，不再使用 19px 分区标题与 9px 正文级信息的跳跃组合。

