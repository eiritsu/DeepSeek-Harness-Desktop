---
description: "为每个规范模型提供一份共享的 models.dev 事实——周期性刷新、有界解析、持久化的最近一次良好快照，以及拒绝而不是猜测——供 DeepSeek Harness 使用。"
kind: "package-reference"
---

# @deepseek-ai/dsh-model-catalog

[English](README.md) | 中文

## 概述

`@deepseek-ai/dsh-model-catalog` 让服务某个模型的每个通道都得到相同的答案。它按间隔读取 models.dev 目录，在字节上限内解析，并把结果发布为一个不可变代次；适配器同步读取该代次，并在整个操作期间固定它，因此在选择器中描述的模型，就是用它被描述时的那份事实来编码的。刷新失败不改变任何内容：最近一次良好代次继续发布，并且跨重启保留在磁盘上。解析后为空文档会被直接拒绝，因此被截断或改变结构的响应无法用「没有事实」替换掉良好的事实。

## 目录

- [使用本包](#use-this-package)
- [实现说明](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

当一个组合通过多个通道提供同一个模型时，或者当模型被描述所依据的事实不应来自「碰巧装得最新的那个包」时，挂载本插件。它依赖存储域（storage domain），因为最近一次良好快照正是在目录不可达时为冷启动提供答案的东西。

### 何时选择它

选择它是为了事实，而不是为了请求。目录从不与提供方通信，也从不决定路由：它贡献的是模型**是什么**，而适配器仍然决定一条路由能**发送**什么。挂载后，对记录携带的每个字段，其记录都优先于路由自身的声明；声明只在目录未覆盖的字段上作答。未挂载目录的组合保留其适配器原本就携带的全部事实。

### 配置文档与映射

每个字段都是可选的；默认值每天读取一次公开的 models.dev 目录。

```yaml
- name: '@deepseek-ai/dsh-model-catalog'
  config:
    catalogURL: https://models.dev/catalog.json?type=all
    refreshIntervalMs: 86400000
    requestTimeoutMs: 15000
    maxResponseBytes: 8388608
    aliases:
      - modelId: gpt-5
        canonicalId: openai/gpt-5
      - ownedBy: acme-gateway
        modelId: flagship
        canonicalId: zhipuai/glm-5.3-flash
```

| 字段 | 默认值 | 含义 |
|---|---|---|
| `catalogURL` | 公开的 models.dev 目录 | 携带规范模型与各通道条目的 JSON 文档 |
| `aliases` | 无 | 把路由本地的模型 id 映射到带限定符的规范 id |
| `refreshIntervalMs` | `86400000` | 一次成功读取的文档保持新鲜的时间 |
| `requestTimeoutMs` | `15000` | 单次请求的最长等待时间 |
| `maxResponseBytes` | `8388608` | 读取的最大响应体大小，在响应体流式传输过程中强制执行 |

`canonicalId` 不带所有者、或 `modelId` 为空的映射会让插件加载失败。两个映射在同一所有者作用域下声明同一个路由本地 id 同样会失败，因为一个说不清自己指的是哪个规范模型的部署，并没有说清。

### 寻址一个模型

三种入口，按优先级排序。配置的映射决定答案——包括它决定「没有答案」的情况，因此指向本代次未携带的规范 id 的映射，会解析为空而不是继续匹配同名模型。其后，带 `owner/model` 的 id 会被精确回答，裸 basename 只有在恰好有一个所有者发布它时才会被回答。每次拒绝都是 `undefined`：适配器保留它原有的事实。

```ts
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-model-catalog'

declare const ctx: Context

const facts = ctx.modelCatalog.facts.facts({ model: 'gpt-5', ownedBy: 'openai' })
// { canonicalId: 'openai/gpt-5', contextWindow: 400_000, maxOutputTokens: 128_000, ... }
```

一条记录携带的内容是模型的属性，而不是服务它的通道的属性：可接受的模态、上下文窗口、输出上限，以及它是否进行推理。唯一与通道相关的部分是 `reasoningEfforts`——该通道声明自己接受的等级。缺失的列表意味着该通道什么都不说；空列表意味着它声明自己一个都不接受，从而拒绝所有显式等级。

-----

<a id="understand-the-implementation"></a>
## 实现说明

### 源码地图

| 文件 | 职责 |
|---|---|
| `src/facts.ts` | 发布的词汇：`ModelFacts`、`ModelFactsRequest`、`ModelFactsView` |
| `src/parse.ts` | 把一份文档有界地读成规范记录与通道词汇 |
| `src/resolve.ts` | `CatalogView`、不可变代次及其寻址规则 |
| `src/service.ts` | 服务：域、周期性刷新、发布与持久快照 |
| `src/config.ts` | 配置 schema，以及唯一应用其默认值的地方 |

### 代次

一次刷新发布一个全新的 `CatalogView`；已发布的视图永不被修改。必须两次用同一份事实作答的消费者——先描述一个模型，再针对它编码一个请求——在整个操作期间持有同一个视图，并通过视图的标识而不是需要轮询的编号来识别刷新。`dsh-llm-pi-ai` 恰好在一个视图下构建其集合，因此选择器的读取与请求的读取之间发生的刷新，会产生两个各自一致的快照，而不是一个混合的快照。

### 哪些地方有界

字节上限在响应体流式传输过程中执行，因此过大或无休止的响应会在到达上限时被放弃，而不是在缓冲完它想发送的全部内容之后。请求超时界定了等待时间。解析本身除这份有界响应体已包含的内容外不再分配内存，而文档无法寻址或未作任何陈述的记录会被跳过，而不是被猜测。

### 持久快照

`model_catalog` 域的全局槽位保存最近一次被接受的文档以及它采集时所针对的 URL。它的存在是为了让目录不可达时的冷启动仍然拥有事实。为另一个 URL 采集的已存文档会被丢弃，而不是在并非为它采集的配置下被读取。持久化失败会被单独报告，并让已发布的事实保持不变：只有下一次冷启动会失去它们。

-----

<a id="further-exploration"></a>
## 延伸阅读

- [LLM（大语言模型）能力包组](../README.zh.md)
- [基于 pi-ai 的路由](../llm-pi-ai/README.zh.md)——读取这些事实的适配器
- [LLM 服务](../llm/README.zh.md)——这些事实所填充的模型信息词汇

-----

<a id="model-experience"></a>
## 模型体验

无，因为本包只回答适配器关于模型的问题，既不构建请求，也不贡献提示词、工具或参数。

#### KV Cache 影响

无。本包产出的任何内容都不会到达提供方的载荷。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- **没有签名或发布者校验。** 文档通过 TLS 从配置的 URL 读取，并按其字面内容被信任。需要锁定发布者的部署应当自行托管该文档，并把 `catalogURL` 指向它。
- **过时的上限可能拒绝一个有效请求。** 把 `maxOutputTokens` 当作硬上限的消费者，会拒绝模型本可接受的配置输出上限。这些事实与最近一次成功刷新一样新，此处没有任何机制保证它们是最新的。
- **词汇由文档决定。** 本版解析器不知道如何读取的事实会被丢弃，因此一个开始发布新字段的文档，会在解析器学会读取之前把它们发布为沉默。

<a id="dev-note"></a>
### 开发备注

无。

**运行时不变式：** 不发布伴生入口。目录只发布一代不可变事实并从持久化存储恢复；它不维护可独立观测的可变关系，每个消费方按视图标识固定自己读到的那一代。
