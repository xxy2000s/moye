# 并行 E2E Restate 容器会耗尽共享 Docker 内存

> 文档类型：Finding  
> 状态：Confirmed  
> 发现日期：2026-08-23

TASK-0048 在持久化真实 Restate 运行后执行 `npm run test:e2e`。Vitest 默认并行启动多个 E2E 文件，每个文件又启动独立 Restate 容器；在当前 Docker 5.773 GiB 配额且存在其他非 Moye 容器时，持久化 `moye-restate-live` 被 OOMKilled，多个 E2E 在 30/40 秒超时，而不是返回功能断言失败。

E2E 文件本来已各自隔离 Runtime、端口和数据，不依赖文件间并行。稳定门禁应限制为单 worker、禁用 file parallelism，使同一时刻最多运行一个测试 Restate；这会增加耗时但不改变测试覆盖。真实产品矩阵继续使用一个专用持久化 Restate 串行执行场景。
