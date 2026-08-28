---
description: "浏览器兼容入口，供在 snapshot-store、settings 与 slot API 迁移到当前包之前构建的客户端插件使用。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-runtime

[English](README.md) | 中文

## 概述

本包让基于上一版本 `@deepseek-ai/dsh-client-runtime/client` 入口构建的浏览器插件，可以与面向当前拆分式客户端架构构建的插件同时加载。它把旧 snapshot-store 与 settings 类型转发给当前 owner，并保留旧 `ClientContext` 类型，但不会创建第二套 renderer、settings service 或 slot registry。新插件应直接从当前 owner 包导入。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

可能加载上一版本客户端 bundle 的 Web 组合只需挂载本包一次。这些 bundle 可以继续请求 `@deepseek-ai/dsh-client-runtime/client`；当前 bundle 则继续直接请求 `dsh-client-store`、`dsh-client-ui-settings` 与 `dsh-client-ui-renderer`。标准 Web bundle 已经挂载该兼容入口。

不要在这里添加新 API。新的客户端插件应从每个值或类型的 owner 包导入，使其 module-table 请求保持显式。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

浏览器入口从 `dsh-client-store` 再导出 `createSnapshotStore`、`defineStore`、`shallowEqual` 及其 store 类型，从 `dsh-client-ui-settings` 再导出 settings scope 类型，并把旧 `ClientContext` 定义为当前 Cordis context 与 renderer 所有的 `SlotRegistry` 类型的交集。`SlotRegistry` 仅用于类型：若再导出或构造另一份运行时 registry，slot contribution 会被拆到两个实例中。Host 与浏览器 `apply` 函数刻意为空，因为当前 owner 包提供真正实现。

本包把 renderer 与 settings 包声明为注入依赖，因此客户端模块图会在旧 consumer 执行前物化它们的当前实现。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [客户端模块系统](../modules/README.zh.md)——module-table 声明、动态提供方与浏览器 bundle 加载。
- [客户端包](../README.zh.md)——浏览器客户端当前的职责拆分。

-----

<a id="model-experience"></a>
## 模型体验

无，因为本包只解析浏览器导入，不贡献任何模型可见内容。

#### KV Cache 影响

无；它不改变提供方请求。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **仅保留上一版本入口**——兼容范围限于受支持外部插件使用的 snapshot-store 函数、settings 类型与 `ClientContext` 类型；本包不是已移除客户端 API 的通用档案。
- **不复制运行时 service**——现在由 renderer 或 settings 拥有的值仍由原 owner 提供；依赖私有 runtime 内部实现的代码必须迁移。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

转发接口应由已安装外部插件的实际证据驱动。只有受支持的上一版本 bundle 确实请求某个导出，并且已有唯一当前包拥有相同行为时，才增加该导出。

</details>
