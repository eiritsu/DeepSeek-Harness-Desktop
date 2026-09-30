---
description: "已定稿用户消息上的 Web 编辑并重发入口及其内联编辑卡片，基于 turnResend Host Remote。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-turn-edit-resend

[English](README.md) | 中文

## 概述

本浏览器插件在已定稿用户消息上添加编辑入口，并在 composer 上方添加内联卡片。入口读取 Host 的 `turnResend.check`，用该回合的提示文本预填卡片，并披露该回合调用的工具。保存调用 `turnResend.submit`；失败时卡片与文本保留。该卡片是编辑重发 Bundle 唯一的浏览器一半，`web` 默认叠加它。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发说明](#dev-note)

<a id="use-this-package"></a>
## 使用本包

`web` profile 叠加 `@deepseek-ai/dsh-session-turn-edit-resend` Bundle，其 patch 挂载本浏览器行与 Host `turnResend` 服务。该行声明 `dsh.client` 并出现在浏览器 roster 中。它注入 slot 注册表、`turnResend` Remote 与文案。

入口注册到用户消息上的 `conversation.chat.user-actions` 列表。卡片注册到 `conversation.input.dock`，因此渲染在 composer 上方。二者共享按 Session 键控的一个 store，因此任一者都能跨重挂载打开、编辑并落定同一次尝试。

保存以铸造的 `operationId` 发送编辑后的文本。Host 会用其日志回答重复标识，因此同一尝试下该按钮绝不会产生第二次模型请求。

<a id="understand-the-implementation"></a>
## 理解实现

### 入口与卡片

[`src/client/index.ts`](src/client/index.ts) 创建 store 并注册两个座位。入口在点击时调用 `check(sessionId)`，并保存返回的文本、回合、范围与 `toolCalls`。当 `toolCalls` 非空时卡片渲染工具披露，通过 `submit(sessionId, { operationId, text }, signal)` 提交，在 `admitted` 时清除，否则保留文本并显示失败行。

可见对话呈现替换后的一代：[`ui-conversation`](../ui-conversation/README.zh.md) 隐藏被 `user/message` 表面替换遮蔽的 seq，因此编辑后的回合在原处显示，而 Session 日志保留每一条事件。

<a id="model-experience"></a>
## 模型体验

### 编辑并重发入口

#### 模型看到什么

不直接看到任何东西。入口与卡片是浏览器呈现；只有 `turnResend.submit` 会到达模型，Host 通过 `agent.followup` 替换模型可见表面。

#### Token 影响

入口与卡片为零。提交的编辑在 Host 中替换被遮蔽的回合，进入下一次请求。

#### KV Cache 影响

独立。浏览器一半不改变任何模型请求前缀。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- **工具披露仅为告知。** 卡片列出重发可能重跑的工具，但无法证明该重复安全；该决定由用户承担。
- **入口以最近一条已完成回合为目标。** `check` 选择该回合，因此在较旧消息上点击入口实际编辑最近一条可编辑回合；Host 在其空闲声明下重新选择，过期目标会被拒绝。
- **无乐观对话改写。** 卡片在 `admitted` 时清除；替换在其 `user/message` 事件到达时进入对话，而非更早。

<a id="dev-note"></a>
### 开发备注

[卡片测试](tests/edit-resend.client.spec.tsx) 覆盖工具披露、提交与失败时的草稿保留。
