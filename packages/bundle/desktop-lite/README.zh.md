---
description: "轻量原生 macOS 壳层：在共享 Web 应用之上提供权威 SQLite 会话、DeepSeek Files 和外部搜索 provider。"
kind: "package-bundle"
---

# @deepseek-ai/dsh-desktop-lite

[English](README.md) | 中文

## 概述

这个 profile bundle 是 Swift/AppKit + WKWebView 应用的最后一层 patch。它保留官方 `dsh-base` 与 `dsh-web-app` 组合，把 JSONL Session 持久化替换为 `dsh-session-persistence-sqlite`，并挂载 DeepSeek Files、外部搜索 provider、SkillHub 和 Lark。

## 目录

- [组合](#composition)
- [模型体验](#model-experience)
- [已知限制与延后工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="composition"></a>
## 组合

Lite 壳和 Electron 壳都指向 `$DSH_HOME/desktop/dsh-desktop.sqlite`。使用相同 `DSH_HOME` 时，两者会看到同一份权威 Session 历史。生产打包必须保证同一时间只有一个桌面写入者。

这个包只包含配置。原生可执行文件、打包脚本和兼容目标见 [`../../../desktop-shell/README.zh.md`](../../../desktop-shell/README.zh.md)。

<a id="model-experience"></a>
## 模型体验

### 桌面功能组合

#### 模型看到的内容

bundle 通过各自 owner package 增加 `lark_cli` 工具，并启用已识别附件文本与外部 Web provider 结果。它不贡献本包自有 prompt 文本。

#### Token 影响

按需产生。只有用户提供待识别文件、运行 Lark 或 Web 工具，或者恢复已持久化 Session 历史时才增加 token。

#### KV Cache 影响

稳定的组合工具 catalog 可以缓存；每个 Session 的历史、附件和工具结果扩展变化的后缀。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与延后工作

- 本包是 Swift shell 的私有最终 patch 层，不是通用 profile bundle。
- 它自身不执行跨进程所有权排斥；Swift 与 Electron shell 必须在启动 Host 前获取共享桌面 runtime lock。

本包不发布运行时 invariant companion；它只是静态 patch 列表载体，运行时关系由被挂载的各个包拥有。

<a id="dev-note"></a>
### 开发备注

保持本 bundle 仅含配置。共享行为属于挂载的 capability 与 Client packages。
