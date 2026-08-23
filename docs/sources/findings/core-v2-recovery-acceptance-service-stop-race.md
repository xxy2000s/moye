# Core v2 Recovery Acceptance 清理 Service 时可能不返回

> 文档类型：Finding
> 状态：Fixed by TASK-0044
> 发现日期：2026-08-23

TASK-0044 首轮五场景真实恢复矩阵已全部输出 `SUCCEEDED / ARCHIVED` 和 `matrix-summary.json` 后，Harness 在最终 `stopService()` 中没有返回。`src/index.ts` 收到 SIGTERM 后仍保持监听；人工只终止该 Harness 创建的精确 Service PID 后，又暴露出 `child.kill()` 与随后注册 `exit` listener 之间的竞争窗口，父进程继续等待已经发生的事件。

后续复跑进一步证明即使精确 Service PID 已消失，`tsx` 的 esbuild helper 或遗留 pipe handle 仍可能保持 Node event loop。最终修复不再依赖 ChildProcess 事件：先按精确 PID 轮询 SIGTERM，必要时 SIGKILL 并验证 PID 消失；成功路径在 `finally` 完成清理后显式 `process.exit(0)`。异常会在到达该语句前传播并保持非零退出，因此不会吞掉验收失败。它不扫描或终止其他 Moye Service，不影响已经完成的 Workflow、Projection 或 Archive Evidence。

业务断言完整证据保留在 `.moye-runtime/acceptance/core-v2/recovery-20260823142107-40380/`；该次命令在摘要落盘后仍需人工中断，因此不冒充退出码 0。修复后的进程收尾由零场景 `HARNESS_CLEANUP_SMOKE` `.moye-runtime/acceptance/core-v2/recovery-20260823145419-37023/` 以正常退出码和无遗留 Harness Child Process 证明；该 smoke 不计入产品验收矩阵。首轮完整业务证据仍保留在 `.moye-runtime/acceptance/core-v2/recovery-20260823124459-67913/`。
