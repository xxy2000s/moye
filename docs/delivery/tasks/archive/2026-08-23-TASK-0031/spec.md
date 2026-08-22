# TASK-0031 Spec：Core v2 Lifecycle Artifact

> 状态：Accepted for implementation
> Spec Revision：1
> Backlog：[BL-0033](../../../backlog/BL-0033.yaml)

## 目标

把 Spec、Design、Plan、Docs Impact、Test Plan、Test Report、Design/Final Review 和 Knowledge Disposition 建模为可序列化、可验证、可跨 Worker 接管的一等 Artifact。

## 需求

- `REQ-0031-01`：九类 Artifact 使用稳定 discriminated schema，禁止以聊天文本冒充；
- `REQ-0031-02`：每个 Artifact 绑定 Task、Spec Revision、Producer Role/Phase、Attempt/Generation/Session、Subject Commit、Content Digest 和 Artifact Digest；
- `REQ-0031-03`：Artifact dependency 明确记录前序 Kind/Revision/Digest，非法或缺失依赖被拒绝；
- `REQ-0031-04`：解析时重算全部 Digest，内容或 Producer 篡改必须失败；
- `REQ-0031-05`：Gate 按 Task/Revision/Commit/Kind/Digest 精确验收，旧 Revision 或错误 Commit Artifact 不得通过；
- `REQ-0031-06`：真实完整 Artifact Chain 测试覆盖从 Spec 到 Knowledge Disposition 的序列化交接。

## 非目标

- 本 Task 不调用真实 Agent；
- 不在本 Task 接入统一 Core v2 Workflow；
- 不定义 Artifact 的文件存储 Adapter，先冻结领域协议。
