# TASK-0054 Spec：统一角色与交付物执行台账布局

> 状态：Accepted for implementation
> Spec Revision：1
> Backlog：[BL-0065](../../../backlog/BL-0065.yaml)

- `REQ-0054-01`：基础 Task / Sealed Task 的“角色与交付物”Tab 必须以紧凑系统执行摘要展示真实 Workflow、Result Commit、Task Package 和 Archive 事实；没有 Agent Session 时不得渲染大面积空卡，也不得补造 Agent；
- `REQ-0054-02`：Core v2 与 Coding Task 必须使用统一的角色执行台账；桌面默认显示紧凑角色列表和一个选中角色详情，不能默认纵向展开全部 Session；
- `REQ-0054-03`：选中角色详情必须展示真实 Revision、Generation / Attempt、Verdict、摘要、Session 技术标识和该角色产生的交付物，并保留 Agent Events 弹窗入口；
- `REQ-0054-04`：全部 Artifact、完整 ID、Digest 与 Coding Journey 必须保留为按需展开的审计事实；Task → Workflow → Candidate → Gate → Merge 关联链移入高级诊断；
- `REQ-0054-05`：Tab 内字号层级必须收敛，正文不得小于 12px；长 ID 默认截断或折叠，不能压过角色结论；
- `REQ-0054-06`：窄屏必须使用可触控的横向角色选择和单列详情，不产生页面级横向滚动；键盘可选择角色并保持 ARIA 关系；
- `REQ-0054-07`：变更必须通过静态契约测试、真实 Runtime 简单/Core v2 桌面与窄屏浏览器验收、`npm run check`、`npm run test:e2e`、Docs Impact Gate 和唯一 Sealed Result Commit。
