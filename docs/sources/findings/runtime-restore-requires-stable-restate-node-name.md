# Finding：Restate 备份恢复缺少稳定 node name

> 状态：Resolved
> 发现日期：2026-08-26
> 来源：TASK-0071 真实 backup → 新 Compose project restore drill
> 处置：[BL-0076](../../delivery/backlog/BL-0076.yaml) → TASK-0071

## 观察事实

双卷 tarball 与 SHA-256 均验证通过，但把 Restate 数据恢复到新容器后，Restate 1.7.4 拒绝启动：卷内数据属于旧容器 hostname，新的默认 node name 不同。Moye `/healthz` 可响应而 `/readyz` 正确返回 503，registrar 未启动，历史 Task 没有被伪造为可用。

## 根因

Compose 未显式设置 `RESTATE_NODE_NAME`，Restate 默认使用容器 hostname；容器重建或异地恢复会改变 hostname。Restate 数据目录把 node name 作为持久身份，不能在已有数据上静默改变。

## 修复与证据

Compose 与配置模板固定 `RESTATE_NODE_NAME=moye-runtime`。备份 Manifest 记录并校验 node name；restore 在解包前要求目标配置一致。修复后重新生成备份并恢复到新 Compose project，Restate、Moye readiness、registrar 和原归档 Task 查询全部通过。
