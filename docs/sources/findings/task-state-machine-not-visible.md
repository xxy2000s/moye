# 页面没有展示 Task 的真实状态机

> 文档类型：Finding  
> 状态：Confirmed  
> 发现日期：2026-08-22  
> 影响范围：Project Board、Coding Trace、Task/Attempt 审计

## 观察

当前 Board 的 Coding Task 详情把 Projection 整理成八个顺序阶段；通用 Task 只展示最终字段和原始事件列表。页面没有同时展示状态机定义、实际转换序列、Repair 回边、失败分支、Attempt Generation 和独立 Archive 状态。

因此用户只能看到“进度条式旅程”，无法从页面判断某个节点是 Runtime 真实进入过、静态 UI 模板，还是由最终字段推测出来的状态。

## 可重复证据

1. `public/app.js` 的 `PIPELINE_STAGES` 是前端静态数组；
2. `renderJourneyStage` 按最终 Projection 拼装阶段状态，没有显示合法转换边和实际转换来源；
3. `renderLegacyTask` 只列出 Event，不把 Event 还原成状态转换；
4. `CodingTaskTrace` 没有状态机定义、当前状态和转换历史的结构化字段；
5. 真实 Review/Repair 执行虽然保存 Run 和 Event，但 Repair Agent Run 尚未形成独立 `StepAttempt`，首次 Verification/Review 的事件时序也晚于实际执行。
6. 真实 Codex 在普通 Git 仓库派生的受管 Worktree 中完成文件修改后，`workspace-write` 沙箱不能写位于 Worktree 外的 Git common dir，导致 `git commit` 创建 `index.lock` 失败；只在系统临时目录成功会掩盖这个产品路径缺口。

## 影响

- 页面无法证明 Workflow 是唯一状态写入者；
- 用户无法区分允许的分支和真实走过的路径；
- Repair 的新 Agent Run 与 Attempt 生命周期无法一一核对；
- 完成状态看起来像黑盒结果，Restate Journal 只能作为排障补充，不能替代业务状态机视图。

## 初步边界

修复必须从持久化 Projection、Event、Attempt 和 Artifact 派生只读状态机视图，不允许在前端创建第二套状态事实。状态机定义与实际历史要明确分开；无法由当前实现证明的完整 Kernel 状态不得伪装为已经运行。

真实 Codex 调用还必须把请求已验证的 `workspaceGitCommonDir` 作为显式可写目录传入沙箱，否则页面即使能展示失败状态，也不能称为普通仓库可用。

后续工作进入 [BL-0021](../../delivery/backlog/BL-0021.yaml)。
