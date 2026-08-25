# TASK-0055 Design

> 状态：Accepted

## 最小修复

顶层 Tab 保留现有横向滚动容器和 ARIA tablist，不改变 DOM 或 JavaScript。CSS 做三项收敛：

1. 显式设定 `overflow-y: hidden`，避免横向滚动策略把纵轴计算为 `auto`；
2. 将选中/焦点指示伪元素固定在容器内部，不再用负 bottom 扩大 scrollable overflow；
3. 顶层 Tab 的 `:focus-visible` 使用背景与加粗的水平指示线，覆盖通用外部 outline，避免裁剪后的竖边，同时保留明确的键盘焦点。

窄屏继续通过 `overflow-x: auto` 滚动，不隐藏 Tab、不修改触控高度。修复不涉及 Runtime 或数据投影。
