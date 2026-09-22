# Agent Note：turn 大纲以重发提示词标注编辑并重发的轮次

Status: implemented

[English](2026-09-22-turn-outline-resend-prompt.md) | 中文

## Problem

[`turnOutline`](../../../../packages/session/session-turn-outline/README.zh.md) 此前只从 `source.kind` 为 `user` 的 `user/message` 事件填充某轮的 `prompt`。编辑并重发以其重发提示词开轮：该事件的 `source.kind` 是 `assistant-retry`，`surfaceOp` 替换被遮蔽的 surface 区间，因此被折叠跳过——条目保持 `prompt: ''`，同轮随后第一条 steering（中途引导）消息用该轮并非由其开启的文本填入了预览。

聊天导航栏恰在已加载窗口不提供内容处读取该大纲——窗口之外的轮次，以及已加载节点不带文本的轮次——因此重发轮在大纲是唯一来源处呈现了别的消息的文字。在 `session-3515b50e-c416-44ee-8dd3-3dd9781ddf61` 中，turn 41 的条目是 steering 消息 `但是这个会话中9月21日和9月22日的记录丢失了`，而非重发提示词 `发现一个问题哈，我们这个会话是不是有记录丢失？`；与此同时聊天 transcript 与已加载的导航栏条目都把该重发提示词呈现为该轮的 opening user message。

## Decision

[`isOpeningPrompt()`](../../../../packages/session/session-turn-outline/src/projection.ts) 接受 `user/message` 事件作为最新轮次的开轮提示词，条件是其 `source.kind` 为 `user`，或其 `source.kind` 为 `assistant-retry` 且事件带替换型 `surfaceOp`。

注入的插件上下文、压缩检查点与已发布版本 retry 的 append 副本仍被排除，因此导航绝不会给出聊天 transcript 未作为 opening user message 呈现的消息。其余折叠规则保持不变：只有最新且仍为空的条目才填充、预览预算不变、草稿身份门保持安静、轮次序号严格递增。

`assistant-retry` 由 session controller 声明，本包并不引用它，因此分类比较的是已声明的 source 字符串而非本地联合类型。

## Alternatives considered

**接受任意替换型 `user/message`。** 压缩检查点同样是替换型 user 消息，仅凭 surface 操作会把预览位交给面向模型的检查点文本；本仓库通过已声明的 source 种类识别检查点与重发副本。

**同时接受已发布版本 retry 的 append 副本。** 聊天 transcript 把该副本呈现为注入上下文，因此大纲会宣传已加载导航栏从不作为该轮开轮消息展示的文字，同一路轮次的两份预览会互相矛盾。

**把预览留给已加载窗口。** 缺陷恰好出现在大纲是唯一来源之处——窗口之外的轮次，或已加载但节点不带文本的轮次——因此空的或标错的条目会在那里持续可见。

**直接对 source 联合类型比较。** `MessageSourceMap` 可通过声明合并扩展，其 `assistant-retry` 成员位于本包未引用的包中，因此字面量比较在本包的编译面无法通过类型检查。

## Verification

[`packages/session/session-turn-outline/tests/projection.spec.ts`](../../../../packages/session/session-turn-outline/tests/projection.spec.ts) 重放真实事件形态——一条自带提示词的更早轮次、`turn/start`、append 的原始提示词、plugin notice、aborted 的 `turn/end`、新的 `turn/start`、携带 `surfaceOp` 与 `sourceEventSeqs` 的替换提示词、`assistant/message`，以及其后一条 steering 提示词——并钉住全部三条大纲条目：重发轮携带重发提示词，每条更早轮次保留自己的提示词与回复。

## Consequences

导航在某重发轮的事件尚未载入时、以及该轮处于已加载窗口之外时，仍以它开轮所用的提示词标注该轮，因此大纲预览与聊天 transcript 的 opening user message 一致。

没有任何条目被删除或改挂：更早的轮次保留各自的提示词与回复预览，向后分页的历史仍可经导航栏到达，注入上下文、工具结果与压缩检查点依旧从不进入导航。
