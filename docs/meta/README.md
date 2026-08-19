# Meta：文档控制面资产

Meta 保存文档体系自身使用的 Schema、模板和治理材料，不保存业务需求或项目设计。

- `templates/`：Backlog、Task、Docs Impact 等可复用模板；
- 根目录 `../graph.yaml`：文档节点、关系、路由和影响策略的机器可读权威来源；
- [Document Control Plane](../knowledge/current/architecture/document-control-plane.md)：文档治理的当前详细设计。

新 Markdown 必须登记到 `docs/graph.yaml`；新模板需要由相应索引或流程文档引用。
