# TASK-0023 Design

## 数据所有权

```text
Workflow Projection + Domain Event
              ↓
      Trace StateMachine
  definition / history / executions
              ↓ read-only
       SVG Graph Canvas
```

画布不定义状态，也不从视觉位置推断状态。节点、合法边、是否经过、当前状态和执行证据全部来自 `TaskStateMachineTrace`。前端布局只决定坐标和视觉路由；未知节点使用确定性 fallback 坐标，避免数据被静默丢弃。

## 布局

- 主路径沿上方横向排列：START → Context → Workspace → Implement → Self Review → Verify → Review → Merge → Docs → Closed；
- Replan 位于主路径上方，表达 Review → Replan → Context 的规格回路；
- WAITING_RECONCILE 位于异常区中心，表达未知副作用先对账再返回原步骤；
- FAILED 位于异常终态区；
- ARCHIVING、ARCHIVED、ARCHIVE_FAILED 位于独立 Archive 区；
- 大量异常边使用曲线与分层通道，筛选器降低同时阅读负担，但“全部”视图仍可访问所有边。

## 交互

- Filter 是一组 `aria-pressed` 按钮，不改写数据，只决定边的可见集合；
- Zoom 使用 SVG 视图缩放，不依赖鼠标滚轮或拖拽；“适配”恢复确定性默认值；
- SVG 节点通过 `<foreignObject><button>` 提供原生键盘、焦点和点击语义；
- 节点详情从同一 Machine 数据派生，列出对应 History 与 Executions；
- 画布刷新时默认选择当前节点；用户主动选择的节点若仍存在则保留。

## 视觉语义

- 已经过：高对比、粗实线、带“实际”文字；
- 当前节点：双描边与“当前”标签；
- Repair/Replan：琥珀色虚线；
- Failure/Reconcile：红色点划线；
- Archive：紫灰色长虚线；
- 未经过正常边：低对比细线。

形状、线宽、虚线、文字和颜色共同表达状态；文本 History 和合法边列表是无障碍 fallback。
