# Backlog 文档未投影到项目看板

> 文档类型：Finding  
> 状态：Confirmed  
> 发现日期：2026-08-20  
> 影响范围：Backlog、ProjectBoard、CLI、Demo

## 观察

`docs/delivery/backlog/BL-0002.yaml` 至 `BL-0007.yaml` 已经存在、加入 Backlog 索引并登记到文档图谱，但启动 Moye Web 看板后，这些条目不会出现在 Backlog 列。

这不是浏览器缓存或页面刷新问题。当前看板只读取 Restate 中 keyed `ProjectBoard/<project_id>` 的运行时 Projection；Git 中的 Backlog YAML 不会自动进入该 Projection。

## 可重复证据

1. `docs/delivery/backlog/README.md` 能看到 BL-0002 至 BL-0007；
2. `src/board/server.ts` 的 `GET /api/board` 只查询 `ProjectBoard.get`；
3. 只有 `POST /api/backlog` 会调用 `ProjectBoard.upsertBacklog`；
4. `scripts/demo.mjs` 只提交动态生成的 `BL-DEMO-*`，不导入仓库中的 Backlog YAML；
5. 文档 Schema 使用 `id`、`source_refs` 和小写枚举，而运行时使用 `backlogId`、`sourceRefs` 和大写枚举，不能直接复用。

## 影响

- Git 中已经确认的研发队列与 Web 看板显示不一致；
- 用户可能误以为 Backlog 没有创建成功；
- Agent 无法从看板确认哪些文档 Backlog 尚未转换为 Task；
- 单纯重启服务不会收敛两套数据。

## 初步边界

需要显式、可校验且幂等的 Backlog Import/Sync，将文档 Backlog 转换并提交到 ProjectBoard。Web 查询路径不应临时扫描文件系统，也不能让 UI 成为第二个 Backlog 状态写入者。

后续工作进入 [BL-0008](../../delivery/backlog/BL-0008.yaml)。
