# TASK-0055 Spec：修复 Task 详情 Tab 的 overflow 与焦点显示伪影

> 状态：Accepted for implementation
> Spec Revision：1
> Backlog：[BL-0066](../../../backlog/BL-0066.yaml)

- `REQ-0055-01`：Task 详情顶层 Tab 在内容未横向溢出的宽屏下不得出现纵向 scrollbar；
- `REQ-0055-02`：选中指示线必须保持在导航边界内，不能增加 `scrollHeight` 或形成竖向伪影；
- `REQ-0055-03`：键盘方向键、Home、End 的焦点反馈必须清晰且不被 overflow 裁剪成孤立竖线；
- `REQ-0055-04`：窄屏仍允许横向滚动，四个 Tab 的 ARIA 选择、焦点与内容切换行为不变；
- `REQ-0055-05`：变更必须通过 CSS 静态契约、真实 Runtime 宽屏/键盘/窄屏浏览器验证、完整门禁、Docs Impact 与唯一 Result Commit Seal。
