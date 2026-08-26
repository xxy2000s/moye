# TASK-0081 Design

> 状态：Approved

UI 以 API 的 `metadata.semantics` 为唯一主提示输入。四个状态使用并列、可换行的审计徽标；主文案只组合 Domain 的 state/reason，Content reasons 通过固定 label map 显示。若 API 缺少版本化 semantics，页面 fail closed 为读取错误，不回退到 legacy 猜测。

`renderManagedSessionContext` 分为三层：四维状态与一句主结论；policy/provider limitation 与 Content reason；默认折叠的“高级诊断”保留 raw state、promptBinding、completeness、metrics、errors 和 Digest。Timeline 加载状态与 footer 改读 semantic Content state，不再把 raw `PARTIAL` 称为“部分 Transcript”。

PENDING 与 WAITING_RECONCILE 继续自动刷新同一 Evidence；UNAVAILABLE/FAILED 提供独立安全建议和 Execution Stream；Artifact integrity error 由 Board server 使用同一 Domain classifier 附带 `FAILED + ARTIFACT_INTEGRITY_FAILED` semantics，UI 显示不可盲重试建议。所有分支只读。
