---
description: "在 DSH 中由凭据门控的外部提供方：用户在设置里配置密钥后才注册模型工具。"
kind: "package-reference"
---

# @deepseek-ai/dsh-external-tools

[English](README.md) | 中文

## 概述

`dsh-external-tools` 通过凭据服务把选定的外部提供方接入 DSH。用户在“设置 → 工具与连接”配置凭据并启用提供方后，对应提供方才会成为模型工具。密钥在调用时解析，不会进入普通设置、插件目录或会话日志。

## 目录

- [使用本包](#use-this-package)
- [提供方生命周期](#provider-lifecycle)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

基础包和 web-app 包都会挂载本插件。Host 侧需要 `tools`、`credentials` 与 `settings`；浏览器侧通过现有设置槽位贡献“设置 → 工具与连接”页面。

首批提供方包括 Brave Search、Tavily、Firecrawl、Exa 与 GitHub。FAL、ElevenLabs 与 Browserbase 已进入凭据目录，可以在不改变设置界面的情况下补充工具实现。

<a id="provider-lifecycle"></a>
## 提供方生命周期

每个目录条目声明 id、显示名、能力、凭据引用、可选接口地址与工具名。注册表监听凭据和设置变化，然后注册或销毁提供方工具。禁用的提供方仍保留配置，但不会注册工具。接口地址覆盖保存在普通设置中；凭据值只由凭据服务保存。

HTTP 提供方检查状态码和 JSON 对象响应。缺少凭据时，工具执行会返回不含密钥的诊断；提供方错误只暴露 HTTP 状态。

<a id="dev-note"></a>
## 开发备注

在 `src/catalog.ts` 增加目录条目，在 `src/providers.ts` 实现工具，并始终通过 `credentialRef` 获取凭据。不要从配置文件读取密钥，也不要在诊断中输出密钥。若插件成为某个 profile 的必需项，请同步更新两个 bundle 的组合。

<a id="model-experience"></a>
## 模型体验

已配置的提供方会把工具定义加入下一次模型请求。工具描述会告诉模型用户应在哪里配置提供方。工具调用前即时读取当前凭据，因此轮换或清除密钥不需要写入会话事件。

### 提供方工具

#### 模型看到的内容

模型只会看到已配置且启用的提供方工具。工具结果只包含提供方 JSON 或不含密钥的 HTTP 错误，凭据值不会进入 schema、提示词或结果。

#### Token 影响

每个启用的提供方贡献一个工具 schema；成本取决于用户启用的提供方数量。

#### KV Cache 影响

改变启用的提供方会从第一个变化的 schema token 起改变工具前缀；提供方集合不变时前缀保持稳定。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与延期工作

- 提供方连接测试、OAuth 流程以及目录中的媒体和浏览器提供方暂未实现。
- 首版提供 API Key 凭据和 HTTP 搜索/提取工具；配额与高级参数仍由各提供方负责。
