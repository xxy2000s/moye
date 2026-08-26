# TASK-0080 Design

> 状态：Approved

新增 `SessionEvidenceSemanticsV1` 作为不可变 Evidence 的确定性读模型。输入只包含 Board 已经通过 binding、Authority、Receipt、Manifest 与 Artifact Digest 校验的字段；输出以 `schemaVersion: 1` 冻结四个相互正交的维度。Availability 由 Runtime/Receipt 终态决定；Content 只在 `AVAILABLE` 时有 `state`，否则显式 `evaluated: false`；Binding 只由 pre-execution Prompt Envelope 是否存在决定；Limitation 汇总 policy/provider 边界并以 `REDACTED > OMITTED_BY_POLICY > NOT_EXPOSED > NONE` 作为稳定主值，同时保留全部原因。

Content 分类不直接信任 legacy `captureState`。它逐维读取 Manifest completeness、metrics、terminal marker 与 capture errors：消息、时间、层级、工具或 raw 的真实 `PARTIAL/UNAVAILABLE`，以及 parse/unknown/drop/terminal/error 事实形成稳定、去重、排序的 reasons。Prompt completeness 和精确识别的历史 Prompt-binding sentinel 只属于 Binding，不进入 Content；`NOT_EXPOSED` 和 policy omission 只属于 Limitation。

Board metadata 继续返回现有 `state`、`promptBinding`、`completeness`、`metrics` 与 `errors` 作为 raw diagnostics，并新增唯一 `semantics` 字段。旧 Evidence byte-for-byte 不变；新语义不持久化、不参与 Receipt/Manifest Digest、不推进 Workflow。Artifact integrity failure 使用同一分类器的 error 入口，供 TASK-0081 在 API error envelope 中传输一致 Availability 与诊断建议。

ADR-0009 接受该读模型并补充 ADR-0007：后者定义 sidecar Evidence 的保存事实，前者定义产品读取时不得把 legacy `PARTIAL` 等同于内容缺失。持久化 Transcript v1 的 `UNSUPPORTED_FORMAT/PARSER` 不在本 Task 改枚举；精确 Digest 兼容仅处理已知历史 sentinel，避免把真实 Parser 错误洗白。

