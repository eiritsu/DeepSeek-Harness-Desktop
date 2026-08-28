# Agent Note：永久删除 Session 与归档及移除 Workspace 相互独立

Status: implemented

[English](2026-08-28-session-permanent-deletion.md) | 中文

## 问题

Workspace 侧边栏可以重命名、分叉和归档 Session，却不能移除持久 Session 日志。归档只会在 Workspace domain 的全局归档集合中隐藏一个 id，删除 Workspace 也只会移除其注册记录。把其中任一操作复用为永久删除，会让破坏性操作看似可恢复，或把 Session 生命周期耦合到 Workspace 元数据。

## 决策

`SessionPersistence.delete(id)` 是与后端无关的永久删除原语。协调器会把它排在同一 id 此前的工作之后执行，拒绝活动 persistence owner，取消尚未物化的创建意图，调用后端移除操作，并在成功后发出 `session-persistence/deleted`。JSONL 会删除当前配置对应的 Session 产物，并在 POSIX 上持久发布目录更新；SQLite 在事务中删除 Session 行，并依靠外键级联删除事件行。SQLite 查询提供方把删除事件作为协调触发器，因此 persistence 无需依赖派生索引。

Session Controller 拥有生命周期与谱系策略。它合并冷态 header 和活动 Session，根据 `parentSession` 计算后代，在存在子会话时拒绝非递归删除，在变更前预检全部目标，并按先子后父的顺序移除。运行中的 Agent、subagent 拥有的生命周期，或不由 API controller 拥有的生命周期都会拒绝删除。空闲且由 API 拥有的 Agent 会在移除存储前 dispose。成功删除还会从 Workspace 记账中分离每个已移除 id。

Client 始终从显式确认对话框请求递归删除。Session 行菜单依次呈现“重命名、分叉、归档、加入工作区、删除会话”。归档仍会立即执行，且在存储语义上可恢复；删除会话使用危险样式，并通过确认说明所选 Session 及其分叉后代。Workspace 删除仍然只删除元数据。

## 验证

共享 persistence 约定会针对 memory、两种编码的 JSONL 与 SQLite 运行永久删除测试，覆盖已物化日志、惰性创建意图、未知 id，以及删除后复用 id。协调器测试钉住删除事件。Host 测试钉住非递归后代拒绝、先子后父的递归顺序与 Workspace 分离。Client 和组件测试钉住列表移除、清除选择、确切的五项菜单、加入工作区、确认对话框与递归请求。

## 考虑过的替代方案

**把归档改成删除。** 否决，因为归档有意保留日志与 Workspace 位置，以供未来的恢复界面使用。

**删除 Workspace 注册记录时一并删除 Session。** 否决，因为 Workspace 是组织元数据；移除它本就保证其 Session 仍会在 Ungrouped 下可用。

**让 persistence dispose 活动 Session。** 否决，因为 persistence 无法区分 API 拥有的 Agent、subagent 生命周期或其他路径拥有的生命周期。Session Controller 拥有该权限，并使存储不依赖 Agent 编排。

## 后果

永久删除无法撤销。递归删除采用自底向上的顺序，因此进程失败可能留下祖先而部分后代已消失；再次执行命令会从剩余 header 收敛。该操作属于单进程生命周期协调，而非跨进程事务。归档仍没有恢复 UI。
