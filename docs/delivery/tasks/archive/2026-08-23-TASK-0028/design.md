# TASK-0028 Design

页面保留单一 HTML 应用，但显式建模两个只读路由：`/` 渲染 Project Board，`/tasks/<task_id>` 渲染全屏 Task Audit Page。Task 卡片使用 `history.pushState`，返回项目使用同一路由函数，`popstate` 重新解析地址；Board Server 只对合法 Task 页面路径回退 `index.html`，API 和静态文件的 404 语义不变。

Task Audit Page 是普通页面区域而非 `<dialog>`。固定页头左侧显示 Task 身份与状态，右上角是“返回项目”；主体继续以状态摘要和 Graph 为中心。Agent Events 仍是独立 Chatbot Dialog，因为它是任务页面内的二级证据下钻。

完整 Domain Event 使用一条垂直时间线：sequence 作为导航锚点，状态转换是主信息，event type / time 是次信息，detail 在每行下方的有界技术区域展示。通用 Task 缺少显式 `from/to` 时从 State Machine History 关联同 sequence，不推断不存在的事实。

本地 Restate 通过 Compose 命名卷持久化 `/restate-data`。Git Archive Catalog 与 Runtime Projection 保持两个明确权威：前者证明任务包和关闭材料存在，后者证明 Workflow Journal、Domain Event 与当前 Board 状态；没有显式导入/对账协议时不互相冒充。
