# TASK-0079 Verification

> 状态：Accepted

## Requirement → Execution → Evidence

| Requirement | Execution | Result / Evidence |
|---|---|---|
| REQ-0079-01 | canonical ProjectBoard 五条真实 Backlog，1440px/390px DOM 与截图 | 五张卡片两种宽度均为 174.8px；卡片只含摘要且不含 `problem` 正文；标题限制两行 |
| REQ-0079-02 | 打开真实 BL-0083 Dialog 并核对可访问树 | observed/expected/impact、4 Evidence、3 affected areas、7 acceptance、source/digest 全部可读 |
| REQ-0079-03 | 初始 load、不可达 ingress、空 Task refs | 加载态独立；不可达 ingress 显示 alert/重新读取，不误报空列表；空 Task refs 显示“未提供” |
| REQ-0079-04 | Chromium 点击卡片 → Escape → activeElement | 原生 Dialog 关闭；焦点精确返回 `查看 Backlog BL-0083…` 触发按钮 |
| REQ-0079-05 | Playwright CLI headed Chromium，1440×1000 与 390×844 | 桌面双列/三栏信息层清晰；窄屏单列、337px Dialog、1525/655px 独立滚动通过；三张截图视觉检查通过 |
| REQ-0079-06 | Browser network log、代码检查 | 页面只 GET `/api/board`；详情不发请求、不回读 Git、不写 Runtime；正常会话 Console 0 error/warning |

## Automated gates

- `node --check public/app.js`：PASS。
- `npx vitest run tests/unit/board-server.test.ts`：1 file / 6 tests PASS。
- `npm run typecheck && npm test`：56 files / 309 tests PASS。
- `npm run check`、Document Graph/Impact 与 `git diff --check`：Result Commit 前最终门禁 PASS。

## Real browser / Runtime evidence

- canonical Runtime：Ingress `50889`、Admin `50890`、ProjectBoard `moye`；验收 Board `3030` 只读连接同一 Projection，未注册 Deployment，验收后已停止。
- 真实网络失败：独立 Board `3031` 指向不可达 ingress 后显示错误态；恢复 canonical ingress 后自动从 0 条回到相同 5 条 Backlog。两个临时端口与浏览器 Session 均已清理。
- 结构化证据：[browser-acceptance.json](./browser-acceptance.json)，Digest `sha256:f2b241283cb48aef6d725cfd69b5ef4c4fedd99aaba1c2d6688d98a2d5d31755`。
- 截图：[桌面 Board](./browser-board-desktop.png) `sha256:7b61ace…aaba`、[桌面详情](./browser-desktop.png) `sha256:b7edaf…b49e`、[390px 详情](./browser-narrow.png) `sha256:8bed0b…884`。

## Boundary

没有修改 Backlog/Task Projection、同步批次、Schema 或 Runtime 服务注册；canonical `3000` 服务保持运行，最终 M3 部署由 TASK-0083 负责。
