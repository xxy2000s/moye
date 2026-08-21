# TASK-0012 Design

## 设计结论

保留现有无框架前端和 Event Viewer 控制器，只改变视图宿主与弹窗栈：

```text
Board
  └── Task Detail Dialog
        └── 查看 Agent Events（入口）

Board
  ├── Task Detail Dialog（保持打开）
  └── Agent Events Dialog（顶层、独立滚动）
```

## DOM 与状态

- Event Dialog 由 `public/index.html` 提供稳定的 Task Detail 同级宿主，`public/app.js` 按当前 Trace 填充内容；它不嵌套在 Task Detail DOM 中；
- 事件数据、cursor、filter、poll timer 属于一次 Event Dialog Session；
- 打开时创建 Session 并加载第一页；关闭时停止 timer、移除 Dialog、恢复入口焦点；
- Task Detail 的关闭逻辑先关闭活动 Event Dialog，避免遗留轮询或孤立遮罩；
- 全局 Escape 只作用于当前最上层 Dialog。

## 样式

- Event Dialog 使用独立 backdrop 和更宽的内容容器；
- header 与筛选栏保持可见，事件列表在主体区域滚动；
- 窄屏回退为近全屏布局，关闭按钮和下载入口始终可达。

## 不变量

- Viewer 仍只调用 Trace 中的受控 Event URL；
- 前端筛选不删除数据；
- Event Dialog 不写 Workflow 状态；
- 关闭 UI 不影响 Agent 执行或 Artifact。
