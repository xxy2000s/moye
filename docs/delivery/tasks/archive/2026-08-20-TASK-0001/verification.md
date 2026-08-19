# TASK-0001 Verification

> 状态：Accepted / Archived  
> Spec Revision：1  
> 验证日期：2026-08-20

用户于 2026-08-20 验收通过；根据反馈新增 `npm run demo` 一键体验入口，降低手工启动、注册和准备 JSON 的使用门槛。

`npm run demo` 已在本机真实执行三轮：首次发现 `3000` 被 Heron 占用，随后改为自动分配空闲端口并校验 Moye 页面；最终验证 Demo Task 自动归档、`Ctrl-C` 清理自身容器且不影响 Heron。

| Requirement | Evidence | Status |
|---|---|---|
| REQ-001 | `tests/unit/task.test.ts`；Task 与 Archive 状态分离测试 | Passed |
| REQ-002 | `TaskWorkflow` / `ArchiveWorkflow` / `ProjectBoard`；真实 Restate E2E | Passed |
| REQ-003 | Archive 6 项单测；rename 后 `SIGKILL` 再恢复 | Passed |
| REQ-004 | Board API 真实查询；桌面浏览器四列与详情交互；控制台 0 error | Passed |
| REQ-005 | CLI 8 个入口；`moye-task-control` Skill 通过 `quick_validate.py` | Passed |
| REQ-006 | TypeScript、12 项单测、2 项 Docker E2E、构建、文档图谱和影响门禁 | Passed |

## 自动验证

```text
npm run typecheck    PASS
npm test             PASS · 4 files / 12 tests
npm run test:e2e     PASS · 2 real-Restate recovery/error tests
npm run build        PASS
npm audit --omit=dev PASS · 0 vulnerabilities（使用官方 npm registry）
npm run demo         PASS · dynamic ports / Task archived / cleanup verified
```

E2E 注入点：`rename(source, target)` 成功后、`ctx.run` 返回前向 Service 发送 `SIGKILL`。恢复断言：

- source 不存在；
- target 唯一存在；
- Task 为 `CLOSED`；
- Archive 为 `ARCHIVED`；
- `ArchiveArchived` 事件只有一次；
- 幂等副作用计数为 `1`；
- ProjectBoard 只在 Archived 列包含该 Task。

第二个 E2E 让 Pipeline 副作用持续产生 `ENOTDIR`：Restate 在 `ctx.run` 内耗尽 5 次预算后，Task 唯一关闭为 `FAILED_TERMINAL`，错误保留在 Projection，失败材料仍由独立 ArchiveWorkflow 归档。它验证了“Step 错误不会留下永远 EXECUTING 的假状态”。

## 可视化验收

- [Board 总览](./evidence/board-overview.png)
- [Task 状态与 Durable Event Trace](./evidence/task-detail.png)

Playwright 使用 1440×1000 真实 Chromium 验证：页面标题、Runtime online、四列计数、Archived 卡片、详情 Dialog、6 个事件均可访问；修复 favicon 后浏览器控制台为 0 error / 0 warning。

## 严格 Review 结论

- 恢复语义：修复 Manifest 写入中断可能遗留随机临时文件的问题，改用稳定 `.pending` 对账；
- 副作用：计数器改为 operation ledger 为事实，重复投递不会增加计数；
- 文件安全：Task ID 白名单、source/target 必须是直接子目录、摘要冲突停止、不盲删目标；
- HTTP 边界：请求体限制 1 MiB、静态文件限定 `publicRoot`、Board 不拥有状态机；
- UI 稳定性：Projection 未变化时不重建卡片 DOM，避免轮询导致焦点和交互引用漂移；
- 依赖：移除本机不可运行的 `@restatedev/restate-server` npm 包，E2E 使用固定官方容器版本。

## 剩余限制

PoC 未实现真实编码 Agent、多 Daemon、Git/PR/Merge、身份认证、请求签名、生产 Telemetry、Repair/Replan 和人工冲突处理。它们不影响本轮“进程中断后 Task/Archive 能否唯一收敛”的验收结论。

## 自举归档结果

2026-08-20 通过真实 `ArchiveWorkflow/TASK-0001` 完成归档：Runtime 返回 `CLOSED + ARCHIVED + SUCCEEDED`，源目录消失，唯一目标为 `docs/delivery/tasks/archive/2026-08-20-TASK-0001`。完整 Workflow 结果见 [`archive-result.json`](./archive-result.json)。
