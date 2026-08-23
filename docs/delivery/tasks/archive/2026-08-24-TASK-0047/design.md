# TASK-0047 Design

> 状态：Accepted

新增纯领域 `core-v2-matrix-audit` 模块和薄 CLI 脚本。输入 Manifest 显式列出四类 suite summary、期望场景集合、Restate Ingress、Board URL 与证据根；审计器不调用 glob、`find` 或目录“最新值”发现。每份 summary 必须声明 `validationKind=PRODUCT_ACCEPTANCE`，每个场景必须有稳定 Task ID、Workflow Ref、Invocation、Role/Session/Event/Manifest、Git/Runner/Gate/Closure/Archive 证据，并与实时 Workflow/Board 查询一致。

领域层返回规范化 finding 列表与统一报告，脚本只负责读取显式路径、执行本地 HTTP/Git/Artifact 校验、写入调用方指定的报告。成功报告自身计算 digest，保留输入 summary digest，避免报告替代原 Evidence。针对预算失败等场景采用显式 expectation profile，不能用一个全局“必须成功”掩盖合法失败。

Document Graph 的 Active/Archive 一致性由同一审计入口读取显式 Task document IDs 验证；当前 TASK-0046 只修正图谱节点和索引关系，不改封存包。
