# TASK-0026 Design

节点 Inspector 调整为：紧凑 Header → Agent 活动主区 → 状态流转记录 → 系统控制 → 技术详情。Agent 活动卡首屏提供完整 Events 主按钮，并异步读取同一个受控 Events URL，展示分类计数与最近三条事件；完整流仍复用现有 Chatbot Dialog。

状态流转记录是 Workflow Domain Event，只回答节点如何进入/离开。Agent Event 是某次 Run/Session 的 JSONL，只回答模型对话、工具和系统活动。预览失败只显示局部错误与重试入口，不改变业务状态或其他节点事实。
