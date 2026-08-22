# TASK-0027 Design

Graph 继续绘制全部合法边，但只有实际经过的边显示紧凑 sequence 标签；未经过合法边的完整说明通过 SVG accessible name 保留，并在节点 Inspector 的按需区域展示。

Inspector 的合法路径从双卡片网格改为单列转换列表：方向标题与计数 → `SOURCE → TARGET` → 人类说明 → 显式运行状态。视觉上使用轻分隔线而非嵌套卡片，状态与说明允许自然换行，短状态徽标保持不换行。
