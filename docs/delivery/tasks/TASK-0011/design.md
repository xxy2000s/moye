# TASK-0011 Design

> 状态：Approved  
> Spec Revision：1

## 权威边界

```text
Coding Workflow / Projection       Agent Event Stream              Board
业务状态唯一写入者              运行时诊断证据                 只读交互视图
        │                               │                            │
        ├─登记 AgentRun locator────────>│                            │
        ├─调用 Runner ─────────────────>│─逐行 append raw JSONL      │
        │                               │<────cursor pages───────────┤
        └─保存最终 Artifact digest─────>│                            │
```

事件流不产生 Task transition。Projection 在 Runner 启动前登记由请求确定性派生的 Run locator，使 Board 能在 Activity 尚未返回时找到活跃流；Runner 完成后，同一 locator 关联现有不可变 Artifact Bundle。

## 增量事件流

子进程执行器新增可选 stdout-line sink。解码器保留跨 chunk 尾部，只对完整换行记录回调，进程结束时再提交最后一条非空残行。Runner 在稳定 Artifact 目录写入 stream metadata 和 growing JSONL；写入失败视为 Agent 执行失败，不能悄悄丢失证据。

元数据只包含请求派生字段和流状态，不保存凭据。重复 Run 先按既有 claim/reconcile 规则处理；已完成 Artifact 直接复用，不再次调用 Agent。

## 查询协议

`GET /api/tasks/:taskId/agent-events?cursor=<n>&limit=<n>` 返回有界事件页。cursor 是该流从零开始的行序号；服务端从 Projection 取得受管 locator，拒绝 URL 路径输入。活动流在读取前固定文件 size snapshot，避免读取期间无限增长；完成流通过 Artifact manifest 摘要校验。

分类由服务端对供应商事件结构做宽容归类，原始行永远随事件返回。未知或 malformed 行标为 `error`/`system` 并保持可见。

## 页面行为

页面维护 `idle → following → complete | error` 的局部查看状态。每页顺序追加并去重；有历史剩余时允许“加载更多”，运行中到达当前尾部后按短周期轮询。筛选只作用于已加载事件；“加载全部”连续读取直到当前快照尾部，运行中仍会继续追踪。

## 安全与容量

- 路径只能来自 Projection 与稳定 Run 请求，且必须位于 Board 配置的 Artifact Root；
- 拒绝 symlink、目录、超出最大事件文件大小或不一致的完成 Artifact；
- 单次 API page size 有上限，前端分批渲染，完整性通过 cursor 而非一次性无限响应实现；
- 所有摘要、原始 JSON 和文本均按纯文本转义渲染。
