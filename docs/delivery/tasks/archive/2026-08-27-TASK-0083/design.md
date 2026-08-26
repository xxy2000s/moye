# TASK-0083 Design

> 状态：Approved

`scripts/m3_acceptance.ts` 是只读聚合器：固定读取 W02/W03/W04/W05/W06 已归档 Evidence，并通过显式 canonical Board/Ingress URL 重新查询现状。它验证已知 Commit、Task、Backlog、Role/Run/Session、Manifest/Receipt/Digest，不枚举目录、不选择 mtime、不写 Runtime。脚手架 pack 矩阵由聚合入口显式调用现有真实 acceptance，并把本轮摘要绑定到报告。

浏览器复核使用当前源码启动临时只读 Board，并连接 canonical ProjectBoard；固定访问 Board 与历史 Session 页面，保存桌面/窄屏/网络恢复结果。临时 Board 不向 Restate 注册，结束后清理。

部署在 Result Commit 后进行：先从 clean Result Commit 构建新的 Service endpoint，健康检查后向 canonical Admin 注册；确认新 Deployment 和 Board/API 可用，再终止旧的 canonical stateless Service。Restate 与 `.moye-runtime/restate-live` 不停止；3014 历史 Service 继续保留，除非只读 Invocation 审计证明无引用。Deployment Receipt 保存在 Runtime/最终报告，不回写已 sealed Commit。
