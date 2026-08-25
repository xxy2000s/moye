# TASK-0065 Spec

> 状态：Approved
> Milestone：M1-W08
> Backlog：[BL-0069](../../../backlog/BL-0069.yaml)

## 目标

把 M1 已分别完成的真实 Codex、Claude、Session Capture 恢复、历史补全与 Board 查询能力收敛为一个无手工点击的产品验收入口，保存可核验的聚合报告，完成文档与本地部署封版。

## Requirements

- `REQ-0065-01`：`npm run acceptance:agent-sessions` 必须调用真实 Codex 和真实 Claude Role Run，并验证 Prompt、Assistant、Tool Call/Result 与受管 Transcript Digest。
- `REQ-0065-02`：聚合入口必须显式绑定一个真实 Session Capture Recovery Evidence，不得扫描目录选择“最新成功”，并重新查询其 Runtime/Board Session API。
- `REQ-0065-03`：聚合入口必须执行 LIVE-006 append-only 历史导入验收，证明七个 Role Receipt 幂等且 source Projection Digest 不变。
- `REQ-0065-04`：聚合报告必须列出 Requirement、Task/Run/Attempt/Session、Manifest/Receipt/Digest 与页面链接，并具有稳定 Report Digest。
- `REQ-0065-05`：真实浏览器在桌面与窄屏验证 Task 页面、角色 Ledger、Session Chatbot、筛选、弹窗与历史补全元数据；Events 不跳转下载。
- `REQ-0065-06`：README、Architecture、CodeMap、Runbook、Milestone 与 Finding/Backlog 的能力/限制表述和最终证据一致。
- `REQ-0065-07`：`npm run check`、`npm run test:e2e` 与产品验收通过，服务由当前 Result Commit 构建并运行在 `http://127.0.0.1:3000`。
- `REQ-0065-08`：M1-W01～W08 全部唯一提交并归档后创建不可变 M1 Tag；不得把生产鉴权、多租户、远端 Artifact 或 Provider 未暴露内容宣称为完成。

## 非目标

- 不实现 M2 的外部项目 Manifest、SDK、包发布或远端 Provider/PR。
- 不修改已经归档的 Task、Role Manifest、Runtime Projection 或 Provider 原生日志。
- 不以 Fake/Mock/单元测试代替真实 Provider 产品证据。
