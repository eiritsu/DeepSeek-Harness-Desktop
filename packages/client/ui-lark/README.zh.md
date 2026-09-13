---
description: "Web Client 中类型化的 Lark/飞书应用、OAuth、权限与私聊状态设置。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-lark

[English](README.md) | 中文

## 概述

`dsh-client-ui-lark` 提供两个桌面产品共用的“Lark 管理”设置区。它挂载生成的 `@deepseek-ai/dsh-lark/remote` Client，展示官方快速连接或自建应用设置，保持 App Secret 只写，区分应用与当前用户授权，报告私聊状态，并在不渲染 JSON 的情况下复制权限模板。

## 目录

- [使用这个包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延后工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用这个包

在 Host 同时挂载 `@deepseek-ai/dsh-lark` 的 Web 组合中挂载本 Client 插件。当前 Electron `desktop` 与 Swift `desktop-lite` 组合已经提供两端。只有类型化 Remote contribution 可用后，设置区才会加载。

用户可以创建托管应用、连接已有应用、在重开设置或重启 App 后继续未完成的用户 OAuth、检查 bot/user 身份与缺少的 scope，并监控私聊 Channel。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部细节 — 点击展开</summary>

`src/client/index.ts` 挂载生成的 Remote 声明，等待所需 UI service，注册类型化中英文 dictionary，并贡献一个 `settings.section` 配置项。`LarkManagementController` 管理可观察 Remote 状态。设置区发送类型化管理调用，只接收脱敏状态；浏览器代码不会获得已保存 App Secret 或 CLI 文件系统访问能力。

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

- [Lark Host 能力](../../lark/lark/README.zh.md) — credentials、CLI、权限与私聊 Session。
- [设置 UI](../ui-settings/README.zh.md) — 本包使用的扩展点。
- [Remote API](../../api/remotes/README.zh.md) — 类型化 Host-to-Client transport。

-----

<a id="model-experience"></a>
## 模型体验

### 管理 UI

#### 模型看到的内容

没有直接内容。本包只贡献 Client 设置 UI；Host Lark 包独立负责模型可见 `lark_cli` 工具与已记录聊天输入。

#### Token 影响

打开、编辑或刷新设置区不会消耗模型 token。

#### KV Cache 影响

无；Settings Remote 位于模型请求之外。

## 已知限制与延后工作

<a id="known-limitations-and-deferred-work"></a>

- 设置区需要配套 Host Remote，不提供独立的纯浏览器 Lark Client。
- OAuth 完成与权限状态依赖 Lark/飞书网络可用性和应用配置。

本包不发布运行时 invariant companion；这个客户端设置投影除 Host Remote 快照外不拥有持久状态。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>面向维护者的工作上下文 — 点击展开</summary>

迁移后的包使用当前 Cordis Client context、renderer、store、locale、Settings slots 与生成的 Typert artifacts。产品文案应保存在 `src/client/locales.ts`。

</details>
