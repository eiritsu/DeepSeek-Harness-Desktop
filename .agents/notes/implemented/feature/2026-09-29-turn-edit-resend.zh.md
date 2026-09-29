# Agent Note: 编辑并重发已完成回合

Status: implemented

[English](2026-09-29-turn-edit-resend.md) | 中文

## Problem

纠正一条已发送的提示词过去只能通过 fork Session，即使用户想继续在同一个 Session 中工作。此前对一个无后端支撑的 Edit 控件的移除，正确地在其 Host 操作存在之前扣下了该入口。仅复用模型表面替换并不够：重发还必须把旧一代从可见 Chat 中移除、保留追加式日志、在重启后不重复模型调用，并保留原提示词的附件。运行过工具的回合是最难的情况，因为重发可以要求模型重复一个日志记录无法撤销的外部副作用。

## Decision

`agent.followup(message, replacement)` 让一条用户消息取代一个表面范围进入。该替换携带 `surfaceOp: { op: 'replace', startSeq, endSeq }` 与 `sourceEventSeqs`，后者列出每个被遮蔽的表面节点。`Session.deriveMessages()` 在该范围原处返回替换消息；日志保留两条记录。inbox 在排队该消息的同一次 `agent/inbox/spliced` 提交中记录该范围，因此驱动器认领前的重启仍会将消息作为该替换准入。

`@deepseek-ai/dsh-session-turn-edit-resend` Bundle 的 Host 服务 `turnResend` 拥有一次尝试。`check` 从日志读取资格；`submit` 在 `agent.runMaintenance` 下重新选择，它在选择、追加与两个操作事件期间持有空闲阶段。它以调用方的 `operationId` 保证幂等：已记录的标识返回其记录，因此重复提交绝不会调用模型两次。`turn-resend/requested` 记录意图，`turn-resend/request-started` 记录持久排队点，准入抛出时记录 `turn-resend/settled: failed`。成功的重发没有进一步事件：予以准入的 `user/message` 替换即其证明，因此已开始但没有该证明的请求重放为 `uncertain`，且绝不重试。服务在 `runMaintenance` 释放驱动器唤醒之前 flush Session，因此模型请求无法先于持久记录。

运行过工具的回合仍可编辑。其工具名随 `check.toolCalls` 返回；替换在模型可见表面遮蔽该回合的工具调用、其结果与其回答，而日志保留它们。浏览器一半与用户确认该重复，而不是拒绝该回合。

`@deepseek-ai/dsh-client-ui-turn-edit-resend` 浏览器包在已定稿用户消息上添加编辑入口，并在 composer 上方添加内联卡片。它调用 `ctx.remote.turnResend`，渲染工具披露，提交编辑后的文本，并如实映射每种记录结果：`admitted` 清除卡片，`uncertain` 说明结果未知且不提供重复，`refused`/`failed`/`pending` 说明日志证明了什么。`web` profile 叠加该 Bundle，其 patch 挂载 Host 服务与浏览器行。`ui-conversation` 隐藏被替换遮蔽的 seq，因此可见对话显示替换后的一代。

该 Bundle 的 `src/types.ts` 是面向浏览器的契约出口：它只导入叶子模块（`@deepseek-ai/dsh-session/types`，绝不导入裸 Session 入口），并且不合并任何 cordis `Context`。裸 Session 入口声明 `Context.sessions: SessionStore`，而 Client 程序将同一键声明为 API `ISessions`；在 `skipLibCheck` 下，编译器静默保留其最先加载的声明，因此从契约可达的任一 Host 导入都会让每个 client 包的 `ctx.sessions` 翻转为 Host 存储。该契约将 Host 服务声明挡在 client 程序之外。

## Alternatives considered

**拒绝工具回合。** 已否决：产品希望即使运行过工具也保留纠正路径，一个用户可以拒绝的披露比一个失效的入口更有用。

**修改或删除原事件。** 已否决：持久化、重放、诊断与无损导出都依赖追加式日志。

**重试不确定的操作。** 已否决：日志无法证明模型是否被调用，重试可能重复一个不可撤销的请求。

**复用队列编辑器。** 已否决：排队消息尚未进入模型历史，而已完成回合已被消费。

## Consequences

- 一次编辑追加一个新回合及 inbox 范围记录；被替换的一代留在日志中，仅在可见对话中被隐藏。
- 被替换范围之前未改变的前缀保持其 provider KV 缓存资格；替换开启新的请求序列。
- 重启从日志读取该操作：已准入的尝试永不重发，不确定的尝试报告为未知。
- 外部副作用仍可能重复；浏览器入口披露工具，Host 不回滚它们。
- 空闲阶段声明是进程本地的，因此共享同一 Session 存储的两个 Host 不会被串行化。
