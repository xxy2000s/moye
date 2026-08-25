# Task 详情 Tab 出现纵向 scrollbar 与被裁剪的键盘焦点竖线

> 文档类型：Finding
> 状态：Resolved by TASK-0055
> 发现日期：2026-08-25
> 影响范围：Task Audit、顶层局部 Tab、键盘焦点、宽屏布局

## 观察

真实 Core v2 Task 在 2048px 宽屏下，`.task-detail-tabs` 的 `clientHeight` 为 40px，但 `scrollHeight` 为 41px；容器计算样式同时得到 `overflow-x: auto` 与 `overflow-y: auto`，右侧因此出现没有业务意义的纵向 scrollbar。

通过键盘方向键切换 Tab 时，通用的 2px 外部 focus outline 被同一个 overflow 容器裁剪，只保留按钮左右竖边。截图中它看起来像选中线突然竖起，而不是完整、明确的键盘焦点反馈。

## 原因

选中指示伪元素使用 `bottom: -1px`，把滚动内容高度扩大 1px；只声明 `overflow-x: auto` 时，另一轴会计算为 `auto`。焦点 outline 又使用正向 `outline-offset`，其外侧部分会被滚动容器裁剪。

## 边界

修复只改变浏览器内 Tab 导航 CSS，不改变 Tab 结构、ARIA、键盘切换逻辑、Task Projection、Event History 或 Runtime 状态。

后续工作进入 [BL-0066](../../delivery/backlog/BL-0066.yaml)。

## 处置

TASK-0055 将纵轴 overflow 显式收敛、把指示线移回容器边界内，并用容器内背景与水平线表达键盘焦点。真实 Runtime 浏览器复测确认宽屏 `clientHeight / scrollHeight` 从 `40 / 41` 收敛为 `40 / 40`，窄屏横向滚动保持可用。
