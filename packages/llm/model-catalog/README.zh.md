---
description: "为模型发现与 prepared call 提供实时 models.dev metadata 补充。"
kind: "package-bundle"
---

# `@deepseek-ai/dsh-model-catalog`

[English](README.md) | 中文

## 概述

`dsh-model-catalog` 通过 `models.dev` 保持 Desktop 模型 metadata 最新。它用已声明的模态、上下文与输出限制和推理等级补充模型发现与 prepared call；缺失字段回退到 pi-ai 已安装 catalog。随发行版提供的 Desktop profile 会启用它，但不会创建 provider 路由或改写 provider 设置。需要让模型声明独立于应用更新时选择它；刷新会增加一次有界网络请求，请求失败时保留上次成功快照。

## 目录

- [使用本包](#use-this-package)
- [了解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与暂缓工作](#known-limitations-and-deferred-work)
- [开发说明](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

| 配置 | 默认值 | 含义 |
| --- | --- | --- |
| `catalogURL` | `https://models.dev/api.json` | 动态提供方／模型 catalog。 |
| `refreshIntervalMs` | `86400000` | 最近一次成功快照的有效期。 |
| `requestTimeoutMs` | `15000` | 远程刷新截止时间。 |
| `maxResponseBytes` | `8388608` | 单次 catalog 响应的实际字节上限。 |

```sh
dsh plugin --profile <custom-profile> add @deepseek-ai/dsh-model-catalog
```

本包声明了 `dsh.bundle.patch`，因此向自定义 profile 安装时会把它加入有序 Bundle 列表。随发行版提供的 Lite 与 Electron overlay 会直接挂载它，同时保留自定义 Bundle。

-----

<a id="understand-the-implementation"></a>
## 了解实现

<details>
<summary>实现内部细节 — 点击展开</summary>

这个 Bundle 挂载一个 Host 插件。插件持久化完整上游 JSON，通过 effect-scoped LLM resolver 投影规范化字段，并让 provider 配置继续由既有组件管理。

### 解析与刷新

Catalog 把上游模态、上下文、输出容量与推理字段标记为 `authoritative`，因此这些字段会在模型发现和 prepared call 中替换本地陈旧值。上游没有声明的字段保留本地值。端点报告的发现字段与更早 enricher 的值仍然优先。

可识别的 `owned_by` 值会选择对应 provider 声明。配置的完整 `baseURL` 若与唯一 provider API 精确匹配，也能为本地路由别名提供同一身份。两者都不存在时，容量和推理等级要求所有同 ID 声明完全一致，而输入模态取共同交集。路由名、协议名、部分 URL 与模型名称模式均不构成能力证据。

模型发现或精确模型查询会刷新陈旧快照。并发查询共用一次刷新；成功时替换快照，失败时保留上次成功数据。模型 ID 使用大小写无关匹配，没有覆盖的字段使用 pi-ai 已安装 catalog。

### 需要的 Harness 底层扩展点

这个 Bundle 可以独立打包，但依赖未修改 DSH runtime 中不存在的模型元数据扩展点：

- `@deepseek-ai/dsh-llm` 提供有序的模型发现补充，以及精确输入和容量解析 API；Harness 源码中的所有者实现位于 `packages/llm/llm/src/index.ts`，公开类型位于 `packages/llm/llm/src/types.ts`。
- `@deepseek-ai/dsh-llm-pi-ai` 会先把精确 owner 与端点元数据交给这些解析器，再使用已安装 catalog 回退；Harness 源码中的所有者适配位于 `packages/llm/llm-pi-ai/src/adapter.ts`。
- Host 模型发现和模型设置页会保留上游 `owned_by` 与可选 `inputModalities`，使网关模型可以匹配正确的 catalog owner。

本包只通过这些 API 提供 catalog 数据，不会自行增加 API、推断推理等级支持或改写 provider 设置。缺少这些扩展点的 DSH build 与本包不兼容。

本包不发布 runtime invariant companion，因为正确性由快照校验与查询测试负责，不存在可独立观察的进程内关系。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [LLM 服务](../llm/README.zh.md)——metadata 注册、模型发现与调用准备。
- [pi-ai 适配器](../llm-pi-ai/README.zh.md)——provider 配置与运行时调用。
- [Lite Desktop](../../../desktop-shell/README.zh.md)——嵌入本 Bundle 的 macOS 原生 profile。
- [Electron Desktop](../../../apps/desktop/README.zh.md)——嵌入本 Bundle 的跨平台 profile。

-----

<a id="model-experience"></a>

## 模型体验

### 动态原生附件准入

#### 模型看到的内容

插件不产生文本。它复制完整的 `models.dev` 输入声明（`text`、`image`、`audio`、`video` 与 `pdf`）。所属适配器会把声明与所选 wire protocol 已实现的序列化能力取交集：支持的附件保持原生输入，不支持的媒体由 `Deepseek-Files` 生成持久识别文本。

#### Token 影响

插件不增加固定 token。准入的附件会产生提供方常规图片 token，以及适配器拥有的图片描述。

#### KV Cache 影响

允许图片进入请求会像提供方原生图片请求一样改变请求内容及其缓存标识。发现元数据不变时，不会引入额外 cache 变化。

## 已知限制与暂缓工作

<a id="known-limitations-and-deferred-work"></a>

- **刷新由查询触发**：模型发现或运行时精确查询会检查快照是否陈旧；插件不在后台轮询，也不静默改写已有模型行。旧缓存会被标记为一次性过期，使下一次查询获取并持久化端点身份与容量。
- **不透明 owner 采用保守结果**：没有可识别的 `owned_by` 或精确提供方端点匹配时，每个字段的同 id 声明必须完全一致，绝不合并提供方特有内容。
- **只有已实现的传输会生效**：catalog 可以声明 `audio`、`video` 或 `pdf`，但 `llm-pi-ai` 仅在能够序列化任意 inline media 的 Google 协议上公开这些模态；其他协议保留 `text/image` 并使用识别回退。
- **输出能力不是请求默认值**：`limit.output` 会确定提供方模型描述符的容量，但只有提供方 profile 显式配置时才会成为请求的 `maxTokens`。
- **推理等级依赖上游声明**：只有 `reasoning_options` 中类型为 `effort` 的标准等级会进入模型能力；上游没有等级列表时，插件不会为该模型猜测支持项。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>
