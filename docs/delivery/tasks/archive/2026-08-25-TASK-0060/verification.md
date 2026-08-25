# TASK-0060 Verification

> 状态：Accepted

| Requirement | Evidence | 结果 |
|---|---|---|
| REQ-0060-01～05 | `tests/unit/claude-session-adapter.test.ts`：唯一 Session locator、stable snapshot、raw/normalized/Manifest、源移走后读取、幂等重放、坏行、超限、Session drift、符号链接、重复源、`digest_only` Prompt、tool_result actor 与模型元数据 | PASS（5 tests） |
| REQ-0060-06 | `npm run acceptance:agent-sessions:claude`：真实 Claude CLI Role Run；最终 Parser 用受 Digest 验证的成功 Role Evidence 重采集，未重复同一 Run | PASS |

真实产品证据：

- Task / Attempt：`TASK-0060` / `TASK-0060.ARCHITECT.r1.g0`；
- Run：`sha256:89c8650283a3f2253b333d69f721bd0b608c2841ef14b7834eff93bc44bc15c5`；
- Provider Session：`a8c3effb-385b-4529-9400-a8b9753bac0d`；
- Role Manifest：`sha256:7103bf12c56c90e635f94f958766ac68da12897300aadd32f2a6ae05b229ea41`；
- Prompt Envelope：`sha256:3f84e0b20b6607c1f84ede7b7cd41b06ef362983dd22751c758c976a4cdf649c`；
- Transcript Manifest：`sha256:c9f28469f017e1f7cb68f28b5aeacde3fe61d7cec70da0c2ad9ce6fb3f99fd30`；
- normalized：`sha256:0f9b86936a9b2c9c1517947a2f1ba438470bf1fabb825159aa35cace40539054`；
- exact-byte source：`sha256:54e839bdf6f814c53234b458277420801fbaa4916280dfb70ef09101939df4aa`；
- Timeline：Prompt 1、Assistant 4、Tool Call 3、Tool Result 3、System 18；
- 最终 Capture Evidence Root：`/var/folders/b1/g0h9j9vd4356lc0n6h6gplz00000gn/T/moye-task-0060-claude-recapture-M2cn0l`；Role 原始 Evidence Root：`moye-task-0060-claude-product-KuUY2j`。

真实失败与修复证据：首次运行 Session `42c3db66-ee9c-4048-9af1-58a2439b6c93` 已返回合法 `structured_output`，旧 Parser 却读取普通 result 文本并标记 `INVALID_OUTPUT`；Finding `finding-claude-role-runtime-ignores-structured-output` 与 BL-0071 记录该事实。修复后 E2E 固定优先级，成功 Role Manifest 经完整 Digest 校验后被最终 Parser 重采集，不调用第二次 Agent。

全库门禁：`npm run check` 通过（43 files / 254 tests，含 TypeScript 与文档图）；`npm run test:e2e` 通过（12 files / 32 tests，2 个显式真实产品入口默认跳过并已由独立命令执行）；`git diff --check` 通过。
