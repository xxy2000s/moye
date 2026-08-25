# Finding：Framework Client 在目标 ref 不存在时仍派发任务

> 状态：Resolved
> 发现日期：2026-08-25
> 来源：TASK-0068 真实 Framework Client 验收
> 处置：[BL-0074](../../delivery/backlog/BL-0074.yaml) → TASK-0068

## 观察事实

首轮 `TASK-FRAMEWORK-20260825223022` 已完成所有 Agent 与 Trusted Test，但在真实 Merge Effect 读取 `refs/heads/release` 时因 ref 不存在进入同一 durable command 的 backoff。Workflow 没有重复 Candidate 或 Merge；在隔离 Fixture 把目标 ref 恢复到冻结 base 后，原 Workflow 继续并唯一归档成功。

## 根因

消费级 Client 只验证了 clean HEAD，没有在派发前证明 `repository.targetRef` 存在且等于冻结 base；验收 Fixture 也漏建目标 ref。

## 修复

`prepareProjectTask` 与 doctor 在派发前解析 target ref，缺失或偏离 base 均稳定拒绝；`moye init` 从当前 symbolic branch 生成默认 target；修正版真实任务 `TASK-FRAMEWORK-20260825224122` 无人工干预完成。

## 剩余边界

Framework MVP 只允许 target ref 等于 frozen base 的本地 Merge。远程分支、PR 和并发目标分支更新属于后续 SCM Provider。
