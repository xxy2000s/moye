# TASK-0036 Design

Test Agent 分两次只读 Attempt：先生成 Test Plan，再读取 Trusted Runner Evidence 形成 Test Report。Runner 将 Intent 原子落盘后才执行 argv-only 子进程，完成后保存 Manifest；Intent-only 恢复返回 UNKNOWN。Workflow 根据报告建议确定性路由，不采信无 Evidence 的 Agent 声明。
