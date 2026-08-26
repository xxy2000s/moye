# TASK-0075 Design

> 状态：Approved

W10 复用 ADR-0008 的单一 Release Identity。Git 中的唯一 Result Commit 先由 SealedTaskWorkflow 校验；Seal 成功后才从该 clean Commit 构建 GA tarball、image、SBOM 和 Release Manifest。Git Tag、GitHub Release、npm 与容器 Registry 是独立外部 Effect：每个目标先查询远端，未应用才写入，回执未知先对账，任何同版本不同 Digest 都 fail closed。

由于 Result Commit SHA 不能自引用，外部发布 Receipt 与最终 GA Manifest 保存在受管 Runtime release evidence 中，不回写或 amend 已封存 Commit。Task package 固化执行协议、预发布验证与预期输出；最终回执由 Runtime/Registry/Git 事实证明。

最终 Service 使用同一 Result Commit 与 `0.1.0` identity，先在备用端口通过健康检查并完成 Restate 注册，再替换 `127.0.0.1:3000` 的旧 Board；不直接编辑历史 Projection。
