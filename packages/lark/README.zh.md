---
description: "Lark 包组：类型化的 Lark/飞书管理、官方 CLI 工具与私聊 Session 入口。"
kind: "package-group"
---

# lark/：Lark 与飞书集成

[English](README.md) | 中文

## 概述

lark 组把已配置的 Lark 或飞书应用接入 DeepSeek Harness。Host 包拥有凭据、权限检查、按 checksum 固定的官方 CLI 与私聊 Session 入口；Client 包提供对应的无 secret 管理界面。本页用于映射包组；包级行为与限制仍由各包 README 定义。

## 目录

- [包](#packages)
- [相关文档](#related-documentation)
- [开发备注](#dev-note)

<a id="packages"></a>
## 包

| 包 | 职责 |
|---|---|
| [`lark`](lark/README.zh.md) | Host Remote service、Credentials 集成、官方 CLI 工具、权限与私聊 Session 生命周期 |
| [`../client/ui-lark`](../client/ui-lark/README.zh.md) | 用于应用设置、OAuth、scope 与 channel 状态的类型化桌面设置投影 |

<a id="related-documentation"></a>
## 相关文档

- [桌面 shell](../../apps/desktop/README.zh.md)——Electron 打包与共享桌面数据所有权。
- [Session 持久化](../../docs/subsystems/persistence.zh.md)——私聊 Session 使用的持久历史。

<a id="dev-note"></a>
## 开发备注

Provider 凭据与 subprocess 访问保留在 Host 包中。Client 响应通过生成的 Remote artifact 保持无 secret 且类型化。
