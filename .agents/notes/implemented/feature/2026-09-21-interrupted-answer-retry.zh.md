# Agent Note: Retry the latest safe assistant answer

Status: implemented

[English](2026-09-21-interrupted-answer-retry.md) | 中文

## Problem

不满意的 assistant 回答会留下一个持久 settlement，而读者对此无能为力：轮次只提供复制与分支，产品中唯一的“重试”是 provider 失败重试策略。要恢复只能重新输入提示词或发送字面量“继续”，前者会重复提示词，后者会把先前的回答当作新输入喂回模型。两者都得不到 regenerate 所需的模型历史：原始提示词只重放一次、不留下被遮蔽的回答，并使用当前的模型、effort 与权限配置。最初的 retry 只寻址被中断的 surface `assistant/message`，因此以仅写入日志的 `assistant/attempt` 结算的停止——只有 reasoning、零输出或部分 stream、没有任何 surface message——会让按钮继续隐藏，而已经完成却让读者不满的回答则完全没有动作。

## Decision

当空闲会话的最新轮次以单条 assistant 回答结束、且该轮次未执行任何 tool call 时，Chat 的开轮 user 消息会在自己的操作栏中、复制按钮旁渲染 Retry 图标按钮。只有普通开轮 user 消息——绝不是 steering 消息——拥有可重放提示词，且只有最新已加载轮次提供该动作。结束回答可能以 surface `assistant/message` 结算——被中断，或其轮次以 `completed` 结束的普通回答——也可能在出现任何 surface message 之前停止、以仅写入日志的 `assistant/attempt` 结算；只有 reasoning 的停止也算，且零输出 attempt 仍会投影其已停止行，使该动作可达。按钮以可持久寻址的目标——message 的 id 或 attempt 的 `seq`——调用 `session/retryInterrupted`，并在同一操作栏显示失败信息。

Host 命令要求 Agent 处于空闲，并从会话当前 surface 与持久 settlement 解析目标。message 地址要求最后一个 surface 节点就是该 `assistant/message`：被中断的 message 无论其轮次如何结束都可重放，而普通回答要求最新已结束轮次以 `completed` 结束。attempt 地址要求最新已结束轮次以 `aborted` 或崩溃修复的 `interrupted` 结束、以该 attempt 作为唯一 settlement，且 surface 上不含 `assistant/message`。两种情况都要求最新已结束轮次拥有该 settlement；在该轮次的 surface 范围内，解析器定位可重放的提示词——普通 `user/message` 或上一次 retry 的 `assistant-retry`——并只接受它到 surface 末端之间的注入式 user 角色上下文与 system 节点。出现 tool call 或 tool result、第二个 assistant 回答或 attempt、第二个可重放提示词，或找不到可重放提示词，都会以 `session/retry-unavailable` 拒绝。

接受时，Host 生成一条新的 `user/message`：内容为该提示词的持久内容（文本与 attachment 引用），source 为可合并扩展的 `assistant-retry` 类型并携带同一持久 `retryOf` 地址。Agent 的一次性 `retryInterrupted(message, replacement)` 能力保存待用的 surface replacement 并唤醒普通 follow-up 轮次；loop 在首轮尝试时以 replacement 的 `surfaceOp: { op: 'replace', startSeq, endSeq }` 与完整 `sourceEventSeqs` 追加该消息，而不是 append。对仅日志 attempt 而言，被替换的 surface 范围止于该轮次最后一个 surface 节点，attempt 的 seq 也加入引用来源。因此新轮次仍走普通 pre-step、当前请求配置与 streaming 路径，同时派生历史中提示词只出现一次、且不含先前的回答。append-only 日志保留被替换的尝试以供审计，replacement 的 provenance 使重试后的回答可以再次重试。

待用 replacement 是一次性的，且绝不覆盖仍在等待的 replacement：被拒绝的 pre-step、被改写或清空的可进入批次、admission 抛错、取消与 driver 退出都会清除它。Client 每个会话只允许一次 admission 在途，忽略第二次点击，并丢弃被连接 reset 失效的结算。

## Alternatives considered

**发送字面量“继续”，或通过输入框重新发送提示词。** 否决：这会追加第二条 user 消息，模型会看到原始提示词、先前的回答与新输入；而且它依赖输入框草稿而非持久提示词。

**由 Host 追加 replacement 后以“不接纳任何消息”唤醒。** 否决：首轮 enter 未接纳任何消息时 loop 会直接结束轮次，step 不会执行；而把唤醒消息按普通 append 追加又会重复提示词。

**把被中断半截回答的内容当作提示词重放。** 否决：半截回答是回答而非提示词，重放它等于让模型续写自己的半句话。

**接受所有候选回答，点击时再由 Host 拒绝。** 否决：必然失败的按钮比没有更糟；解析器会提前拒绝歧义形态。

**只要 Client 无法证明与 Host 完全一致就隐藏按钮。** 部分否决：Client 的 Turn 数据已能证明“无 tool、单回答、最新轮次”的形态，以及 Host 现在接受的 runtime-context 情形。剩余情形——自动 goal 轮次，或轮次内多出一条普通 user 输入——对 Client 的轮次尾部数据不可见，因此该次点击在该操作栏以 `session/retry-unavailable` 报错，而不是隐藏按钮。

## Consequences

该动作复用既有 surface replacement 与 provenance 机制，因此 `SESSION_FORMAT_VERSION` 不变：唯一的新持久事实是一条 `user/message` replacement，其 source 是可合并扩展的 `MessageSourceMap` 条目，其 `retryOf` 现在是 `MessageId | SessionInterruptedRetryTarget` 读取联合——released 0.1.20 写入裸中断 message id，当前写入方始终写入地址，Host 解析器与 Client 投影都不依赖该值，因此旧日志按原样重放。Agent 新增可选的 `retryInterrupted` 能力；未实现它的 driver 会报告 `session/retry-unavailable`。被替换范围由当前 surface 尾部而非数值区间界定，因此提示词与 surface 末端之间的注入式 runtime-context 节点会一同被遮蔽；仅日志 attempt 则加入引用来源。Chat Assistant node 会从持久 `assistant/attempt` stream 重建被中断前缀，使已停止的回答在冷恢复后仍可呈现，且只用于最终 attempt，不会把被取代尝试的 timing 带入后续成功消息；未交付任何 block 的 attempt 仍会投影其已停止行，因此零输出停止仍保留重试动作。执行过 tool、attempt 地址所在轮次还有其他 settlement、存在多于一个 surface assistant 回答、结束原因不是 `completed` 的已完成轮次，或由可重放提示词之外的输入开启的轮次都无法重试。
