# Milestone 1：完整 Agent Session 与 Prompt 证据链

> 文档类型：Delivery Plan
> 状态：Approved / In execution
> 计划基线：2026-08-25
> 冻结 Revision：1
> 前置事实：Core v2 关键状态机矩阵已经通过；当前缺口位于 Agent Session 的采集、持久化、查询和历史补全，不得把现有 CLI stdout Viewer 描述为完整 Transcript。
> 执行边界：项目 Owner 已批准本文范围；按冻结 Task 映射顺序执行，一个 Task 对应一个 Result Commit。

## 1. Milestone Outcome

让每个真实 Codex 或 Claude Role Run 都形成可迁移、可校验、可查询的完整 Session 证据：

```text
Task Input
  → Structured Prompt Envelope
  → Agent Process / CLI Execution Events
  → Provider-native Session Transcript
  → Normalized Timeline
  → Managed Artifact + Digest + Receipt
  → Board Chatbot Timeline
```

完成后，页面必须能够区分并查询：

- 最终用户原始需求；
- Moye 系统管控指令；
- Role 专用指令与最终 rendered Prompt；
- Assistant 消息；
- Tool Call、Tool Result、System、Error 和 stderr；
- Session、Attempt、Revision、Generation、父子 Agent 与 Workflow 的真实绑定；
- Transcript 的来源、采集策略、完整性和不可用原因。

## 2. 当前证据基线

当前实现保存的是 `codex exec --json` 或 Claude `stream-json` stdout，不是 Provider 原生 Session Transcript：

- `src/agent/role-runtime-v2.ts` 生成完整 Prompt，但执行 Intent 只保存 `instructionsDigest`；
- Role `events.jsonl` 保存 CLI stdout，Board 再通过独立启发式分类器展示；
- Codex 原生 Session 位于 `~/.codex/sessions/**/*.jsonl`，其中 `event_msg/user_message` 保存实际角色 Prompt；
- Claude 原生 Session 位于 `~/.claude/projects/**/*.jsonl`，包含 user/assistant、工具、时间戳和父子关系；
- LIVE-006 的七个 Role Session ID 当前均能定位到原生 Codex Session；原 Moye Artifact 与自身 Manifest Digest 一致，但源数据层级不足；
- 当前 Board 历史 404 还受到 Artifact allowlist 配置影响，该问题与 Transcript 不完整是两个独立缺陷；
- `MOYE_CAPTURE_USER_PROMPTS` 只接入普通 Claude Coding Runner 的原生 OTel，不覆盖 Core v2、Codex 或 Board。

这些事实只说明修复输入和边界，不代表 Milestone 已实现。

## 3. 工作包

每个工作包对应一个冻结的 Runtime Task ID 和唯一 Result Commit；任一 Task 未通过 Seal 与 Archive，不开始其依赖项。

| Work Package / Task | 依赖 | 交付范围 | 核心验收 |
|---|---|---|---|
| `M1-W01 / TASK-0058` Session Evidence Contract | 无 | 登记真实 Finding/Backlog；定义 Prompt、Locator、Timeline、Manifest、Receipt；完成 Artifact、隐私、兼容 ADR | 旧 Role Manifest 仍可读取；新 Artifact 精确绑定 Task/Role/Attempt/Run/Session/Provider/Digest；采集状态与错误枚举稳定 |
| `M1-W02 / TASK-0059` Codex Native Session Adapter | W01 | 按已确认 `thread_id` 定位、快照并解析 Codex rollout；保留 raw 与 normalized Artifact；解析 Prompt、Assistant、工具、时间戳和父子 Thread | 真实 Codex Role 的完整 Prompt 和 Timeline 被受管 Artifact 固化；源文件移走后仍可读取；越界、符号链接、超限、坏行 fail closed |
| `M1-W03 / TASK-0060` Claude Native Session Adapter | W01 | 按 `sessionId` 定位、快照并解析 Claude Session；规范 text/thinking/tool_use/tool_result、UUID/parentUUID、Subagent 和模型元数据 | 真实 Claude Role 完整采集；工具结果不冒充用户对话；源文件移走后仍可读取；安全检查与 Codex 对称 |
| `M1-W04 / TASK-0061` Core v2 Runtime Integration | W02、W03 | Agent 启动前持久化 Prompt Envelope；Role 开始前发布 active Run locator；结束后执行幂等 Transcript capture；保存 stderr；中断后只恢复采集、不重复 Agent | 运行中可定位 Session；Prompt 先于外部执行持久化；Intent-only/回执未知不会产生第二个 Agent Run；旧 Attempt 不能绑定新 Revision/Generation |
| `M1-W05 / TASK-0062` Unified Timeline and Board API | W04 | Runtime 与 Board 共用唯一 Normalizer；API 分离 execution stream、normalized transcript、raw metadata 和 stderr；支持 cursor、刷新和精确错误 | 不再由三套分类器产生漂移；Board 不扫描用户 Home；稳定错误与等待状态可区分 |
| `M1-W06 / TASK-0063` Agent Session Chatbot UX | W05 | 重构现有弹窗；展示 Prompt/User、Assistant、Tool Call、Tool Result、System、Error/stderr；显示来源、采集策略、父子 Session 和完整性 | Events 仍在弹窗内；桌面和窄屏可用；筛选、自动刷新、键盘操作和长内容折叠通过真实浏览器验收 |
| `M1-W07 / TASK-0064` Append-only Historical Enrichment | W02、W03、W05 | 新增不推进 Task 主状态的 Transcript Enrichment Workflow/Effect；按旧 Session ID 追加 Import Receipt；补全 LIVE-006 及仍有源文件的历史 Session | 不改旧 Manifest、Projection、Domain Event 或 Outcome；重复导入幂等、冲突拒绝；LIVE-006 7/7 有真实 Import Receipt；缺源明确记录而不伪造 |
| `M1-W08 / TASK-0065` Product Acceptance, Docs and Deployment | W04～W07 | 增加真实 Codex/Claude、故障恢复、历史导入和 Board 端到端入口；更新 README、Architecture、CodeMap、Runbook、Finding/Backlog 和限制声明；部署验收服务 | `npm run check`、`npm run test:e2e` 和 Session 产品验收全通过；最终服务在 `127.0.0.1:3000`；每个场景有 Task/Run/Session/Digest/页面链接 |

## 4. 固定执行顺序

```text
M1-W01
  ├── M1-W02
  └── M1-W03
        ↓
      M1-W04
        ↓
      M1-W05
        ↓
      M1-W06
        ↓
      M1-W07
        ↓
      M1-W08
```

W02 与 W03 可以在隔离 Worktree 中并行实现；其余工作包按依赖顺序串行 Seal。任何工作包未通过验证和 Archive Gate，不启动依赖它的后续 Task。

## 5. 跨工作包不变量

1. `execution-events.jsonl` 与 `session-transcript.jsonl` 是不同 Artifact，不能互相覆盖或冒充。
2. Board 只读取受管 Artifact，不在请求时扫描 `~/.codex`、`~/.claude` 或 Worker 本地缓存。
3. Provider Session 关系只作为诊断补充；Moye 的 Task → Role → Attempt → Run 仍是业务主链。
4. Transcript capture 失败不能重跑 Agent；未知采集结果只恢复或对账同一 capture effect。
5. Prompt 内容按 `digest_only | redacted | full` 策略持久化；OTel 只作为诊断副本。
6. 历史补全只能追加独立 Receipt，不修改已经封存的 Manifest、Commit、Projection 或 Event。
7. 任何 UI 降级都必须说明 `PARTIAL` 或具体错误，不能把缺少 Prompt 的 stdout 称为完整 Session。
8. 完整 Prompt、源码和工具输出属于敏感数据；无鉴权的非本机暴露不能作为默认配置。

## 6. 产品验收矩阵

最终自动化入口暂定：

```bash
npm run acceptance:agent-sessions
npm run acceptance:agent-sessions:history
```

至少覆盖：

- 真实 Codex Prompt、Assistant、Tool Call/Result、timestamp；
- 真实 Claude Prompt、Assistant、Tool Call/Result、parentUUID/Subagent；
- Agent 执行中实时定位和刷新；
- Prompt Envelope 已持久化后强杀 Worker；
- Provider 已完成但 Transcript Receipt 未确认时强杀 Worker；
- 相同 Capture 重放幂等、冲突 Digest 拒绝；
- Provider Home 原文件移走后仍能从 Moye Artifact 读取；
- allowlist、缺源、权限、符号链接、超限、Malformed JSONL 和 Artifact 篡改；
- stderr 与错误事件进入统一 Timeline；
- 历史 LIVE-006 七个 Role Session append-only 导入；
- 旧 Role Manifest、Runtime Projection 与 Domain Event Digest 保持不变；
- 桌面与移动端真实浏览器验收。

Fake/Mock 只用于低层 Parser 边界，不得作为 Codex/Claude 产品验收通过证据。

## 7. 长时运行规则

- 批准后先把 W01～W08 转为真实 Task；每个 Task 有独立 Spec、Design、Plan、Verification、Docs Impact、Result Commit、Seal 和 Archive Receipt；
- 默认自动处理普通技术决策；只有缺少外部权限、不可恢复破坏风险或审批内容内部冲突时阻塞；
- 不改写任何历史 Commit、Task Artifact、Restate Projection 或 Provider 原生 Session；
- 失败 Task 也必须形成真实失败 Closure 和 Archive；
- 每个 Task 关闭后检查工作区、Worktree、进程和容器，再自动进入下一个；
- 最终报告逐项列出 Task ID、Result Commit、Runtime Outcome、Session ID、Transcript Digest、Receipt 和页面链接。

## 8. Milestone 完成定义

只有同时满足以下条件，M1 才能宣布完成：

1. W01～W08 全部形成唯一 Result Commit 和归档终态；
2. 新 Codex 与 Claude Role Run 都有 Prompt Envelope 和 Transcript Disposition；
3. 完整 Transcript 不依赖 Provider Home 或 Board 本地目录扫描；
4. LIVE-006 七个历史 Session 通过 append-only Receipt 合法补全；
5. Board 能准确展示完整、部分、等待和不可用状态；
6. 真实故障测试证明 Agent 不重复、Capture 不重复、旧 Evidence 不越界；
7. 自动化、浏览器、文档门禁和最终部署全部通过；
8. 文档明确列出 Provider 原生日志未暴露内容、加密 reasoning 和生产保留策略等剩余限制。

## 9. 审批记录

- 当前结论：项目 Owner 于 2026-08-25 批准 Revision 1，并授权无中途交互的连续执行。
- 冻结映射：TASK-0058～TASK-0065 分别对应 W01～W08；只允许逐个创建 Active Task。
- 当前执行：TASK-0058（M1-W01）。
