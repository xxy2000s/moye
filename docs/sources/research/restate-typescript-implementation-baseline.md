# Restate TypeScript PoC 实现基线

> 类型：Research  
> 状态：Current for PoC  
> 调研日期：2026-08-19

## 结论

首个 Moye Runtime PoC 使用 Node.js 22、TypeScript、Restate TypeScript SDK 1.16.7 和 Restate Server 1.7.4。

## 依据

- [Restate TypeScript SDK 官方仓库](https://github.com/restatedev/sdk-typescript)要求 Node.js 22，并说明 SDK 1.15–1.16 与 Server 1.7 兼容；
- [Restate Workflows 官方文档](https://docs.restate.dev/tour/workflows)说明 Workflow Step、状态、Promise 和 Timer 在服务退出后通过 Journal 恢复；
- [Restate 官方安装文档](https://docs.restate.dev/installation)提供单二进制/容器化 Server；
- 2026-08-19 通过 npm Registry 查询：`@restatedev/restate-sdk=1.16.7`、`@restatedev/restate-server=1.7.4`；
- 当前机器 Node.js 为 22.23.2，npm 为 10.9.8，满足 SDK 要求。
- 官方 `docker.restate.dev/restatedev/restate:1.7.4` 容器已在 macOS arm64 上完成端到端验证。

## 限制

- TypeScript ingress client 在 2026 年存在 Workflow 泛型推断问题的公开 Issue；PoC 的外部调用优先使用稳定 HTTP Ingress，避免把类型缺陷引入核心验证；
- npm 包 `@restatedev/restate-server@1.7.4` 在本机不包含 `darwin-arm64` 可执行文件，因此未作为测试启动器；E2E 固定使用官方容器。该限制属于分发形态，不影响 SDK/Server 协议验证；
- 版本只针对本次 PoC 固定，升级需要重新运行集成和故障注入测试；
- 本结论不代表最终生产语言选择。
