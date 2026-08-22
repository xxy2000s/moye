# TASK-0028 Verification

> 状态：Accepted
> 验证日期：2026-08-22

## 自动化证据

- `node --check public/app.js`：通过；
- `npm run check`：28 个单元测试文件、155 个测试通过，TypeScript 与 247 份文档图谱校验通过；
- `npx vitest run tests/e2e --maxWorkers=1`：5 个真实 Restate E2E 文件、14 个测试通过；
- `npx vitest run tests/e2e/demo.test.ts --maxWorkers=1`：新的合法 Task 直达路由、非法 Task 404、全屏页面结构、Domain Event 时间线和持久化 Compose 契约通过；
- `npm run runtime:config` 与 `git diff --check`：通过。

## 真实浏览器证据

预览服务：`http://127.0.0.1:3021`，真实 Runtime Task：`TASK-0027`。

- 从项目卡片进入 `/tasks/TASK-0027`，详情占据完整页面，项目 Masthead 不泄漏；右上角“返回项目”、浏览器 Back/Forward 与直接刷新均正常；
- 直接刷新最初暴露 `TASK_GRAPH_POSITIONS before initialization`，修复初始化时序后控制台为 0 error / 0 warning；
- 完整 Domain Event 展开后显示 7 条真实事件；有 History 的条目显示 `START → RECEIVED` 等实际转换，没有转换的业务事实明确标记且保留真实 detail，不伪造边；
- 375×812 下页面 `clientWidth = scrollWidth = 360`，无横向溢出；节点 Inspector 以 Bottom Sheet 展开，`Esc` 收起后焦点回到原节点；
- Agent Events 仍使用任务页内 Chatbot Dialog，不跳转下载，节点执行细节与系统控制保持可查。

## 持久化证据

- `npm run runtime:up` 在本机自动选用可用的 `docker-compose`，创建 `moye_restate_data` 并挂载到 `/restate-data`；
- 向该 Runtime 的 `ProjectBoard/moye` 同步真实 Git Backlog Projection 后执行 `runtime:down → runtime:up`；重启后同一卷仍挂载，`BL-0004` 仍可查询；
- 验收后只停止该临时标准 Runtime，没有删除数据卷；用户当前查看用的 `moye-restate-live` 继续使用宿主持久化挂载。

## 历史数据结论

Git 中 27 个历史 Task Archive 目录和 240 个受版本控制文件仍存在。旧临时 Restate 容器没有 `/restate-data` 挂载，随容器重建丢失的 ProjectBoard Projection 与 Workflow Journal 无法从 Git 原样恢复；页面没有扫描 Git 目录冒充 Runtime History。

## 剩余限制

当前只保证新标准启动的 Runtime 持久化；尚未实现 Git Task Archive 到 Restate Projection/Journal 的显式导入与对账协议，因此已丢失的旧运行历史不会自动回填到页面。
