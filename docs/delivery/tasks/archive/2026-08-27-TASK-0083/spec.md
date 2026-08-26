# TASK-0083 Spec

> 状态：Approved
> Milestone：[M3 W07](../../../milestones/m3-backlog-and-session-clarity.md)
> 前置：[TASK-0077](../2026-08-27-TASK-0077/spec.md)～[TASK-0082](../2026-08-27-TASK-0082/spec.md)

## 目标

把 M3 的 Backlog v2、正式同步、详情 UX、Session 四维语义/诊断和标准文档脚手架收敛成一个显式、无目录扫描的产品验收入口，完成仓库门禁、真实浏览器复核、canonical Service Deployment 与文档封版。

## Requirements

- `REQ-0083-01`：新增 `npm run acceptance:m3`，只读取固定路径、固定 Task/Backlog/Session 标识和明确 Runtime URL；不得扫描目录挑选“最新成功”。
- `REQ-0083-02`：聚合报告必须验证 TASK-0077～0082 的 Git Result Commit/唯一父提交/Runtime `CLOSED + ARCHIVED + SUCCEEDED`，并绑定每个任务的 Evidence/Package Digest。
- `REQ-0083-03`：对 canonical Board 重新验证五个开放 Backlog、BL-0031 不可见、BL-0083 problem 详情、W02 正式 Sync Receipt 与幂等重放事实；不得写 Projection。
- `REQ-0083-04`：对固定历史 Session 重新查询 API，验证 `AVAILABLE + COMPLETE + UNVERIFIED + NONE`、受管 Manifest/Receipt/Digest 与 W04/W05 浏览器证据；旧 Artifact 不得改写。
- `REQ-0083-05`：重新执行仓库外 packed scaffold 矩阵，并绑定 W06 权威真实 Task 的 custom Policy、Trace、bundle、Scaffold Manifest 与归档状态。
- `REQ-0083-06`：在最终当前源码浏览器中复核 Backlog/Session 的 1440px、390px、键盘、网络恢复与只读边界；保存结构化结果和截图。
- `REQ-0083-07`：`npm run check`、`npm run test:e2e`、`npm run acceptance:m3`、Document Graph、Docs Impact 与 diff 门禁全部通过。
- `REQ-0083-08`：Result Commit 后以同一 Commit 构建 Service，注册 canonical Restate Deployment，平滑替换 `http://127.0.0.1:3000`，保留 Runtime/Artifact/历史需要的 Service；最终 `/readyz`、Board/API 与 Deployment Commit 一致。
- `REQ-0083-09`：更新 README、Architecture、CodeMap、Runbook 与 M3 Milestone，明确完成事实、Evidence、页面入口和仍未实现的生产能力；不把本地验证冒充 Registry 发布。

## 非目标

- 不迁移已完成历史 Backlog，不重写 Session Evidence/Manifest/Receipt/Digest。
- 不删除仍被 Invocation 引用的历史 Service，不停止 canonical Restate 数据卷。
- 不发布 npm、GitHub Release 或容器 Registry，不实现 Auth/RBAC、远端 Artifact/Git Provider、多 Daemon fencing。
