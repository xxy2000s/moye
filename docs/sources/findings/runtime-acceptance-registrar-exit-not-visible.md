# Finding：Runtime 验收漏查已成功退出的 registrar

> 状态：Resolved
> 发现日期：2026-08-25
> 来源：TASK-0071 首轮真实 Compose 验收
> 处置：[BL-0075](../../delivery/backlog/BL-0075.yaml) → TASK-0071

## 观察事实

首轮真实镜像已成功构建，Moye Service 健康，registrar 日志明确显示 deployment 注册成功且容器 `Exited (0)`；验收脚本仍等待 60 秒后误报超时。

## 根因

一次性 registrar 正常完成后不再属于运行中容器。脚本使用 `compose ps -q register`，因此得到空 ID；应查询包含已停止容器的 `compose ps -a -q register`，再验证精确 ExitCode。

## 修复与证据

TASK-0071 改为查询 `ps -a`，保留 ExitCode=0 门禁。最终完整验收得到 `TASK-RUNTIME-1787702994174`，经过两次 Runtime 重启、备份和跨 project restore 仍保持同一 Projection Digest，临时 project 的容器、网络与双卷最终精确清理。
