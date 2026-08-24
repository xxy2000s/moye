# TASK-0050 Spec：重构 Core v2 状态机画布与节点审计详情

> 状态：Accepted for implementation
> Spec Revision：1
> Backlog：[BL-0061](../../../backlog/BL-0061.yaml)

- `REQ-0050-01`：Task Audit 默认仍以居中总览和 Graph 为主；Graph 适配视图必须优先保证本次实际主路径的节点和 sequence 可读，Recovery、Replan、Reconcile、Failure 与 Archive 必须紧凑分区，不再用大块空白承载未发生分支；
- `REQ-0050-02`：完整合法状态和转换不得删除。路径筛选、节点详情和文本清单仍可核对全部 Definition，只有 History 实际经过的边和节点可以点亮；
- `REQ-0050-03`：节点 Inspector 必须按“Agent 活动、系统管控、状态流转、证据与技术 ID、合法路径”形成稳定层级。有真实 Session 时，完整 Agent Events 入口必须位于首屏主操作区；
- `REQ-0050-04`：无 Agent Session 的 Workflow、Gate、Trusted Runner、Merge、Closure 与 Archive 节点必须明确显示系统所有权和控制事实，不得显示为缺失 Agent 数据；
- `REQ-0050-05`：Domain Event 时间线必须先显示 sequence、业务转换或事实摘要、事件类型与时间。原始 detail 必须按需展开并保持逐字节只读，不以长代码块占据默认阅读层；
- `REQ-0050-06`：合法进入与离开路径必须使用扁平可扫描结构，本次经过排在未发生路径之前，并同时保留 direction、kind、事件 sequence 与完整说明；
- `REQ-0050-07`：Agent Events 继续在 Chatbot Dialog 内显示并支持对话、工具调用、工具结果、系统和错误筛选，不允许改为下载或新窗口；
- `REQ-0050-08`：桌面、窄屏与键盘操作必须可完成 Graph 筛选、节点选择、Inspector 关闭和 Events 弹窗审计；页面继续只读，不增加状态推进 API；
- `REQ-0050-09`：变更必须有定向单元测试、真实 Runtime 浏览器验收、`npm run check`、`npm run test:e2e`、Docs Impact Gate 和唯一 Sealed Result Commit。
