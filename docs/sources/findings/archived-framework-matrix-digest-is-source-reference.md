# 归档 Framework Matrix 的 Evidence Digest 实际指向 Runtime 源文件

> 文档类型：Finding
> 状态：Resolved by TASK-0075
> 发现日期：2026-08-26

## 现象

`.moye-runtime/acceptance/framework-matrix-20260826114406/framework-product-matrix.json` 的 `evidenceDigest` 与移除该字段后的 canonical 内容一致。W09 归档包中的同名文件后来增加 `runtimeEvidenceRoot`、`cleanInstall` 和 `preservedDiagnostics`，但仍保留源文件的 digest，因此归档文件本身计算出的 digest 为另一个值。

## 影响

W09 Runtime Evidence 没有损坏，六个目标 Task 的实时 Projection 也没有漂移；但消费者若把归档汇总的 `evidenceDigest` 误解成该文件自身 digest，会得到校验失败。

## 处置

不改写已封存 TASK-0074。TASK-0075 新增 `framework-product-matrix-live-recheck.json`，明确使用 `sourceEvidenceDigest` 指向原始 Runtime Matrix，并为 W10 live recheck 的最终结构计算独立 `reportDigest`。后续汇总 Artifact 必须在所有说明字段加入后再计算自己的 digest。
