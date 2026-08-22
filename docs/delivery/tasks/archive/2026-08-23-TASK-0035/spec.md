# TASK-0035 Spec：Documentation Agent 与文档门禁

> 状态：Accepted for implementation  
> Spec Revision：1  
> Backlog：[BL-0037](../../../backlog/BL-0037.yaml)

- `REQ-0035-01`：只接受绑定当前 Candidate Commit 的成功 DOCUMENTATION Attempt；
- `REQ-0035-02`：产出依赖 Spec/Design 的 `DOCS_IMPACT` Artifact，包含 re-route digest、报告引用和逐文档 disposition；
- `REQ-0035-03`：Agent 结果不能自行绕过文档门禁推进状态；
- `REQ-0035-04`：错误 Revision、Commit、Generation 或空处置必须确定性拒绝；
- `REQ-0035-05`：通过后才能进入独立 Test Plan 阶段。
