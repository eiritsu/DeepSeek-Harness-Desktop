# Agent Note: 跨持久与派生状态永久删除 Session

Status: implemented

[English](2026-08-23-permanent-session-deletion.md) | 中文

## Problem

归档只会隐藏 Session，不改变日志或 Workspace 记账，但用户还需要明确的永久删除操作。若只移除主日志，Workspace 账本、归档集合、内容搜索行和消息反馈 sidecar 仍会引用已经不存在的身份。若没有统一所有权规则就删除实时 Session 或父 Session，还可能与最终持久化竞态，或遗留后代。

## Decision

`SessionPersistence.delete(id)` 是持久删除权威。它拒绝实时 Session，与同 id 的先前工作串行化，使 preparation 状态失效，在不创建产物的情况下取消尚未实体化的延迟创建 intent，并把已实体化内容的移除委托给后端。JSONL 会删除 transcript 和已变为空的 Session 目录，并在 POSIX 上 fsync 父目录；SQLite 会在一个事务中删除 Session 行和级联事件。只有当身份已经离开持久化视图后，成功路径才 emit `session-persistence/deleted`。

Host `session.delete` 操作负责产品编排。它从实时与持久 header 构建完整后代集合，拒绝对有后代的目标执行非递归删除，在变更前预检所有目标，拒绝任何运行中目标，只 dispose 当前 gateway 持有 handle 的 Agent，并按先后代、后祖先的顺序删除。新建空白 Session 在 dispose 后没有持久产物；Host 会把这个已知的临时身份视为删除成功，并 emit 相同清理事件。递归重试允许某个后代已经被更早的部分尝试移除。

各派生所有者独立订阅。Workspace 会从 header／path 索引、所有 Session 记账和归档集合中移除该 id；session-query 会协调其可丢弃的 SQLite 索引；message-feedback 会把生命周期 sidecar 的移除排在已经接纳的变更之后。持久化层不导入任何派生包。

Workspace 浏览器把「复制 Session ID」「归档 Session」和「删除 Session」呈现为不同操作，空白 Session 行也包含这三项。删除使用明确的永久操作确认框并请求递归删除；失败后对话框保持打开。复制写入不透明 `SessionId`，归档仍是非破坏性操作并立即隐藏该行。

## Alternatives considered

**只用归档作为移除操作。** 归档在数据层面可逆并保留记账，但不能满足擦除 Session 日志及相关本地记录的需求。同时保留两项操作可以明确区分语义。

**自动取消运行中的 Session。** 不予采纳，因为取消与永久删除是两个不同的破坏性决定，且取消期间仍可能在收敛工具效果和最终持久化。调用方先停止运行，再执行删除。

**从 Workspace 删除级联。** 不予采纳，因为 Workspace 注册记录不拥有目录或 Session 日志。删除 Workspace 仍会把保留的 Session 移入 Ungrouped；只有 Session 操作才删除 Session 状态。

**由各后端清理派生数据。** 不予采纳，因为这会反转依赖方向，也无法覆盖可选 consumer。单一删除后事件让持久权威保持收窄，并让可重建投影自行拥有清理逻辑。

## Consequences

删除会立即生效，没有回收站或撤销窗口。内容寻址的 attachment 对象可能被多个 Session 共享，而且目前没有引用感知垃圾回收器，因此它们会保留在 attachment 后端；已删除的 Session 日志不再引用它们。预检会在目标仍实时或由外部所有者持有时避免普通的部分删除，但多所有者清理不是跨存储事务：进程崩溃可能打断后代删除或某个派生订阅方。重复递归请求会使主存储收敛，Workspace 状态会自行剪除缺失 id，session-query 可重建；带外移除存储仍不会 emit 事件，并可能留下受身份保护的 sidecar。

共享持久化 contract 会针对 JSONL 和 SQLite 覆盖已实体化、未知、复用和延迟身份。协调器测试固定实时所有者拒绝与事件时机；Host 测试固定空白删除、运行中拒绝和后代优先的递归行为；UI 测试固定三个菜单操作与永久删除呈现；message-feedback 测试固定 sidecar 清理。
