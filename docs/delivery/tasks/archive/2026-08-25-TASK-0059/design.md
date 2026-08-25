# TASK-0059 Design

Adapter 只接受 Workflow 冻结的 `SessionTranscriptCaptureIntentV1`、Prompt Envelope 和显式受管根目录。它不查询 Board、不推进 Task 状态，也不把 Provider Home 路径持久化为业务事实。

定位阶段在 allowlisted root 下逐个检查物理目录和普通 JSONL 文件，从首个 `session_meta.payload.id` 验证已确认 `thread_id`，拒绝符号链接、越界、重复和超限。捕获阶段先读取稳定字节并校验前后文件身份，再以确定性 parser 产生统一 Timeline。raw、normalized 和 manifest 用 `wx + 相同内容可复用/冲突拒绝` 写入受管 Artifact Root，因此源文件不再是唯一事实。
