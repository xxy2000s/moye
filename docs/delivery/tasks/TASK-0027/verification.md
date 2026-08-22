# TASK-0027 Verification

> 状态：Accepted
> 验证日期：2026-08-22

## 自动化证据

- `node --check public/app.js`：通过；
- `npm run check`：28 个单元测试文件、155 个测试通过，TypeScript 与文档图校验通过；
- `npx vitest run tests/e2e --maxWorkers=1`：5 个真实 Restate E2E 文件、14 个测试通过；
- `ruby scripts/docs_graph.rb validate`：通过；
- `git diff --check`：通过。

首次直接执行并行 `npm run test:e2e` 时，5 个 Restate 套件同时启动后出现 6 个 timeout；容器清理确认只剩项目已有 Phoenix，随后以单 Worker 顺序运行同一套 E2E 全部通过。该结果保留为环境并发证据，不冒充首轮成功。

## 真实浏览器证据

服务：`http://127.0.0.1:3020`，Task：`TASK-LIVE-ROLE-STREAM-2-20260822`，节点：`IMPLEMENT`。

- 总览只在实际边显示 `#1`、`#3`、`#5` 等 Event sequence 徽标，未发生边没有可见小字说明；
- 合法转换显示 `进入 3 · 离开 4`，每行包含完整 `SOURCE → TARGET`、转换类型、说明和明确的运行状态；
- 实际边显示 `本次经过 · #5/#7`，其余显示 `合法但未发生`；
- 375×812 下 Inspector `clientWidth = 345`、`scrollWidth = 345`，无横向溢出；844×390 仍可滚动查看；
- 桌面、手机竖屏、手机横屏浏览器控制台均为 0 error / 0 warning。

## 剩余限制

状态机布局仍是针对当前 Coding/Task Definition 的固定位置映射，不是可编辑或自动布局的通用 Graph 编辑器。本任务只修复信息披露和合法路径可读性。
