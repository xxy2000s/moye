# Trusted Test 文件摘要没有绑定落盘 Evidence 原始字节

> 文档类型：Finding
> 状态：Confirmed / Fixed by TASK-0041
> 发现日期：2026-08-23

真实 Task `TASK-CORE-V2-MERGE-UNKNOWN-004` 的 Final Reviewer 重新计算 `TC-1.stdout.txt` 和 `TC-1.stderr.txt` 后，发现 Manifest 中的 Digest 使用 `namespace + NUL + JSON string`，并不是 Artifact 文件原始字节的 SHA-256。Test Assessment 仅依据退出码给出 PASS，Final Review 正确形成 Blocking Finding 并进入 Generation 1 Repair。

TASK-0041 将 stdout/stderr Digest 改为原始文件字节 SHA-256，并让 Manifest 复用/CONFIRMED 路径重新读取文件校验 Digest；命名空间 Digest 继续只用于 Run/Manifest 身份。
