# TASK-0010 Design

> 状态：Approved  
> Spec Revision：1

## 交互边界

```text
Task 详情 ──点击──> 内联 Agent Events Viewer
                         │
                         ├── fetch 既有 allowlisted Artifact URL
                         ├── 逐行解析 JSONL、生成安全摘要
                         └── 明确入口下载原始 JSONL
```

后端 Artifact 路由及其 realpath、文件类型、大小和摘要校验保持不变。看板只消费 Trace API 已返回的 URL，不接受用户输入路径。

## 前端状态

查看器只维护 `idle → loading → loaded | empty | error` 的页面状态；它不是 Task 生命周期状态机。成功加载后缓存已渲染结果，按钮只负责展开/折叠。每条事件显示序号、类型、摘要，并使用原生 `details/summary` 展开格式化 JSON。

## 安全与容量

所有事件字段和格式化 JSON 都通过既有 HTML 转义函数输出。解析失败的行作为普通文本显示并标记异常，不执行或插入 HTML。页面最多渲染固定数量的事件，剩余数量明确提示并引导下载原始文件。
