# TASK-0067 Design

> 状态：Approved

Manifest parser 先以 YAML safe parse 读取未知输入，再迁移 legacy `version: 0` 的窄化字段，最后执行严格结构校验和 filesystem boundary 校验。公共 canonical 结果不保存本机绝对路径；运行时 resolver 单独返回真实仓库根。

命令统一保存为 argv 数组，执行端继续 `shell:false`。相对路径先做词法边界检查，再从真实仓库根逐段检查已有 ancestor 的 `realpath`，拒绝符号链接逃逸。Artifact 默认 `.moye/artifacts`，但禁止与配置文件冲突。

JSON Schema 作为发布资产；TypeScript validator 是确定性信任边界，两者由测试保持一致。Digest 对默认值展开后的 canonical manifest 计算。
