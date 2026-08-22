# TASK-0024 Design

## 信息层级

```text
Task Audit Dialog
├── Compact Header / Task Summary
├── Graph Workspace
│   ├── Filters / Zoom / Legend
│   ├── Centered SVG Canvas
│   ├── Optional Node Inspector
│   └── Collapsible Actual History
└── Secondary Evidence
    ├── Step / Attempt
    ├── Role Sessions
    └── Advanced Diagnostics
```

默认只展开前两层。Graph 是 Master，Inspector 是按需 Detail；Agent Events 是独立的第三层 Chatbot Dialog。

## 桌面布局

- 外层 Dialog 约占视口 `94vw × 92vh`，内部由固定 Header 和可滚动内容组成；
- Graph Workspace 的画布区以单列居中开始；打开 Inspector 后切换为 `minmax(0, 1fr) 400px`；
- Inspector 关闭不重新渲染 Machine，也不重置 Filter、Zoom 或 Scroll；
- History 使用原生 `details`，摘要持续显示实际转换数量和首尾落点。

## 窄屏布局

- Dialog 占满视口并尊重 safe area；
- Inspector 以固定 Bottom Sheet 呈现，最大高度约 `72dvh`，背景仍是当前 Graph；
- Sheet 与 Dialog 各自有明确关闭入口，Escape 优先关闭 Sheet，再关闭 Task Detail；
- Filter 工具栏换行，Graph 横向滚动限制在自己的容器。

## 状态边界

`selectedId` 只表示 Graph 当前选择；新增 `inspectorOpen` 明确区分“当前节点用于画布标记”和“用户已要求查看详情”。刷新时只要节点仍存在便保留选择和开关。所有这些 UI 状态都不进入 Runtime、URL 或持久化 Artifact。
