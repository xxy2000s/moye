# TASK-0047 Plan

> 状态：Completed

1. [完成] 定义显式矩阵 Manifest、suite/scenario expectation 与统一 Audit Report；
2. [完成] 实现 summary schema、唯一性和必需 Evidence 校验；
3. [完成] 接入实时 Restate Workflow、TaskAuthority、Board 与真实 Git/Artifact 复核；
4. [完成] 增加场景专属重复副作用、失效 Evidence、失败 Closure 与 Archive 断言；
5. [完成] 新增 `npm run acceptance:core-v2:audit`，拒绝目录发现和非产品 validation kind；
6. [完成] 修复 TASK-0046 Graph Archive 状态漂移并加入门禁；
7. [完成] 用现有四份真实 suite summary 做首次跨矩阵审计，保留 25 个预期 Finding 作为 TASK-0048 新 Task 重跑边界；
8. [完成] 运行全量自动门禁，更新文档和 Docs Impact；唯一 Result Commit 与 Seal 在 package stage 后执行。
