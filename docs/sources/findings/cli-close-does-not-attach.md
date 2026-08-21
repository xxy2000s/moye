# CLI close 未按契约附着既有 Workflow

> 文档类型：Finding
> 状态：Confirmed
> 发现日期：2026-08-22
> 影响范围：Task CLI、TaskWorkflow、Goal Bootstrap 关闭流程

## 观察

对 `TASK-0013` 执行标准命令序列：

```text
npm run cli -- create --file /tmp/moye-task-0013.json
npm run cli -- close --file /tmp/moye-task-0013.json
```

`create` 返回 `Accepted` 和唯一 Invocation ID；紧接着 `close` 返回 Restate 409：`the workflow method was already invoked`。随后查询 `status TASK-0013`，权威 Projection 已经是 `CLOSED + ARCHIVED`，Result Commit、Bootstrap Evidence 和唯一 Archive 均正确。

## 可重复证据

1. CLI 帮助和项目 Skill 声明 `close` 会附着同一个 keyed Workflow 并等待业务终态；
2. `src/cli/index.ts` 的 `create` 使用异步 `send(..., "run", input)`；
3. 同文件的 `close` 再次使用普通 `invoke(..., "run", input)`；
4. Restate 1.7.4 将第二次 Workflow `run` 视为重复启动并返回 409，而不是附着既有 Invocation；
5. `status` 能读取后台已完成的唯一 Projection，说明业务 Workflow 没有失败，也没有生成第二条生命周期。

## 影响

- Agent 按文档执行标准关闭序列时会收到假失败；
- 自动化可能误把成功关闭判断为阻塞，或者进行无意义重试；
- CLI 行为与 `moye-task-control`、README/Runbook 的承诺不一致；
- Runtime 的唯一性和 Archive 结果本身未受影响。

## 初步边界

修复应让 `close` 通过 Restate Workflow attach/output 语义等待既有 Invocation，并兼容“尚未提交、运行中、已完成”三种可判定情况。不能通过吞掉所有 409 或新建第二个 Workflow 伪装成功。

后续工作进入 [BL-0019](../../delivery/backlog/BL-0019.yaml)。
