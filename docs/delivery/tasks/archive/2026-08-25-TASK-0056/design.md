# TASK-0056 Design

> 状态：Accepted

## 权威分层

- `AGENTS.md` 定义仓库级档位、适用边界、完成标准和升级规则；
- `moye-task-control` Skill 实现 `auto` 判定顺序和三个档位的操作步骤；
- Document Control Plane 说明 Lite exemption 是显式治理规则，不是绕过文档门禁；
- Runtime Workflow、Task Projection 和 CLI 不增加第二套 mode 状态机。

## 判定原则

`auto` 默认选择满足风险约束的最低档位。Lite 必须同时满足所有白名单条件；任一 Core、契约、数据、依赖、安全或外部副作用触发器即升级。用户可以要求更高档位，但不能强制降低安全档位。

`performance` 与单 Agent/并行 Agent 属于执行策略，正交于治理档位；`ultimate` 不进入规范枚举，避免名称无法映射到确定门禁。
