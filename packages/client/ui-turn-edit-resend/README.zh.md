---
description: "已定稿用户消息上的 Web 编辑并重发入口，以及就地取代该消息的编辑器，基于 turnResend Host Remote。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-turn-edit-resend

[English](README.md) | 中文

## 概述

本浏览器插件在已定稿用户消息上添加编辑入口，并在尝试打开期间用就地编辑器取代该消息。入口读取 Host 的 `turnResend.check`，用该回合的提示文本预填编辑器，并披露该回合调用的工具。保存调用 `turnResend.submit`；失败时编辑器与文本保留，Host 拒绝的点击会在同一位置说明原因。本插件是编辑重发 Bundle 唯一的浏览器一半，`web` 默认叠加它。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>
## 使用本包

`web` profile 叠加 `@deepseek-ai/dsh-session-turn-edit-resend` Bundle，其 patch 挂载本浏览器行与 Host 的 `turnResend` 服务。该行声明 `dsh.client` 并出现在浏览器名单中。它注入 slot 注册表、`turnResend` Remote、文案，以及 Chat 的消息体占用服务。

入口注册到用户消息上的 `conversation.chat.user-actions` 列表。打开一次尝试会通过 `ctx.uiChat.claimUserMessageBody(sessionId, seq, owner)` 占用该消息的消息体；`conversation.chat.user-body` 链式条目接受该占用，并就地渲染编辑器取代气泡，气泡本身仍挂载在下层。释放占用即返回气泡。两个座位共享按 Session 键控的一个 store，因此任一者都能跨重挂载打开、编辑并落定同一次尝试。

保存会携带新铸的 `operationId` 发送编辑后的文本。Host 对其日志中已有的同一标识直接作答，因此该按钮绝不会为同一次尝试产生第二次模型请求。

<a id="understand-the-implementation"></a>
## 理解实现

### 入口与就地编辑器

[`src/client/index.ts`](src/client/index.ts) 创建 store、占用并释放消息体，并注册两个座位。入口在点击时调用 `check(sessionId)`；可编辑的回答会保存返回的文本、回合、范围与 `toolCalls`，并占用被点击的 seq；拒绝或传输失败则为该 seq 保存一条提示。当 `toolCalls` 非空时编辑器渲染工具披露，通过 `submit(sessionId, { operationId, text }, signal)` 提交，在 `admitted` 时清除，否则保留文本并显示失败行；提示形态只说明原因并提供关闭。

同一 Session 的消息同一时刻只由一个占用拥有：新的占用会替换旧的，Chat 注册表把被替换占用的释放变为空操作，因此过期的编辑器绝不会释放其后继者的占用。

可见对话呈现替换后的一代：[`ui-conversation`](../ui-conversation/README.zh.md) 隐藏被 `user/message` 表面替换遮蔽的 seq，因此编辑后的回合显示在原回合的位置，而 Session 日志保留每个事件。

<a id="model-experience"></a>
## 模型体验

### 编辑并重发入口

#### 模型看到什么

不直接看到任何东西。入口与编辑器是浏览器呈现；只有 `turnResend.submit` 会到达模型，Host 通过 `agent.followup` 替换模型可见表面。

#### Token 影响

入口与编辑器为零。提交的编辑在 Host 中替换被遮蔽的回合，进入下一次请求。

#### KV 缓存影响

独立。浏览器一半不改变任何模型请求前缀。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

本插件不发布 runtime invariant companion，因为它不产生独立事件流：slot registry 管理各项贡献的生命周期，而按 Session 键控的草稿与消息体占用由交互测试直接检查。

- **工具披露仅为告知。** 编辑器列出重发可能重跑的工具，但无法证明该重复安全；该决定由用户承担。
- **入口只出现在最近一条回合上。** `check` 选择最近一条可替换回合，因此较早的提示不显示编辑入口；Host 在其空闲声明下重新选择，并拒绝过期目标。
- **打开的尝试只存在于进程内。** 编辑器及其草稿保存在客户端内存中，刷新即丢弃该尝试；Session 日志已保存全部持久记录。
- **不做乐观的对话编辑。** 编辑器在 `admitted` 时关闭；替换消息在其 `user/message` 事件到达时才进入对话，而不是更早。

<a id="dev-note"></a>
### 开发备注

[编辑器测试](tests/turn-resend-body.client.spec.tsx)覆盖工具披露、提交、提示与失败时的草稿保留；[入口测试](tests/turn-resend-action.client.spec.tsx)覆盖回合门控与点击的各类结果。
