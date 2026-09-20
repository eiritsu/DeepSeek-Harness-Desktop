---
description: "桌面 Web 客户端的「电脑操作」设置分区：一个原生桌面控制运行时的总开关。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-computer-use

[English](README.md) | 中文

## 概述

`dsh-client-ui-computer-use` 提供两个桌面产品共用的**电脑操作**设置分区。该分区承载原生桌面控制总开关及其当前状态，并通过 `ctx.settingsScope` 写入原生 Cua Driver 提供方设置命名空间的持久化 `enabled` 字段。它仅在 Host 提供该命名空间时注册，因此未挂载提供方的组合既不会显示页面，也不会显示其导航项。

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

在 Host 同时挂载 `@deepseek-ai/dsh-computer-use-cua-driver-native` 的 Web 组合中挂载本 Client 插件。当前 Electron `desktop` 与 Swift `desktop-lite` 组合已同时提供两端。关闭开关会拆除原生运行时并释放电脑操作注册；重新打开会再次初始化运行时。页面仅在 Host 提供该命名空间时渲染，因此未部署提供方时不会留下任何痕迹。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部细节 — 点击展开</summary>

`src/client/index.ts` 通过 `ctx.settingsScope` 绑定提供方命名空间，注册中英文 dictionary，并贡献一个 `settings.section` 配置项。该贡献受可用性门控：作用域进入 `ready` 状态时注册分区，之后的 `unavailable` 状态（包括重连带来的状态）会将其移除。`src/settings-contract.ts` 以浏览器本地字面量重述命名空间、字段与默认值，因为浏览器半边无法值导入 Host 插件。

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

- [Cua Driver 原生提供方](../../computer-use/cua-driver-native/README.zh.md) — 本分区所切换的 Host 运行时。
- [电脑操作子系统](../../../docs/subsystems/computer-use.zh.md) — 提供方 seam 及其生命周期。
- [设置 UI](../ui-settings/README.zh.md) — 本包使用的 slot 与 scope 扩展点。

-----

<a id="model-experience"></a>
## 模型体验

### 运行时开关

#### 模型看到的内容

没有直接内容。本包只贡献 Client 设置 UI；Host 提供方独立负责 `cua_driver_native__*` 工具 schema 与电脑操作指导分区，二者仅在持久化设置为启用时存在。

#### Token 影响

启用运行时会为后续请求加入提供方的工具 schema 与其固定指导分区；停用则移除两者。已发出的请求不受影响。

#### KV Cache 影响

开关会改变工具 schema 前缀与提示中的指导分区，因此变更后的首个请求无法复用变更前的前缀缓存。

## 已知限制与延后工作

<a id="known-limitations-and-deferred-work"></a>

- 该分区仅由 Electron `desktop` 与 Swift `desktop-lite` 组合挂载；`web` profile 不会加载它。
- 该开关释放并重新占用同一个独占的电脑操作注册，因此无法切换到其他提供方。
- 该分区仅在 Host 提供提供方命名空间时存在；省略提供方行（或将对应的 Cordis 行标记为 `disabled`）的组合不会渲染导航项，而运行时开关会使该行保持挂载、分区保持可见。

本包不发布运行时 invariant companion；这个客户端设置分区仅镜像一个 Host 设置命名空间，不拥有可独立观测的状态。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>面向维护者的工作上下文 — 点击展开</summary>

产品文案保留在 `src/client/locales.ts`。`src/settings-contract.ts` 中的命名空间、字段与默认值字面量由 `tests/settings-contract.client.spec.ts` 固定；Host 提供方在自身的测试套件中固定相同的值，因此任一侧的变更都必须同步更新两侧。

</details>
