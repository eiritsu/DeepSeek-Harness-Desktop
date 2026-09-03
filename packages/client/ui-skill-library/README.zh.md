---
description: "面向 macOS WKWebView 桌面壳的 SkillHub 技能发现与审查界面。"
kind: "package-bundle"
---

# @deepseek-ai/dsh-client-ui-skill-library

[English](README.md) | 中文

## 概述

`dsh-client-ui-skill-library` 在 macOS 桌面壳公开 `window.dshDesktopPluginBridge` 时增加技能库侧边栏入口和 shell overlay。它发现 SkillHub 技能，按来源、场景或 API Key 筛选并分页，打开选中的 SkillHub 页面，并请求桌面壳把选中的压缩包导入 Application Support 下的技能根目录。

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

Web 应用会挂载这个包，但入口只在配套 macOS 桌面壳内可见。从侧边栏打开“技能库”，即可浏览 SkillHub 技能，按来源、场景或 API Key 缩小结果范围，并把 package 导入桌面管理的技能根目录。

### 挂载到其他 Web 组合

把浏览器插件作为普通 Cordis 配置项挂载即可。它没有公开配置字段，并且在 document-start bridge 不存在时保持休眠。

```yaml
- name: '@deepseek-ai/dsh-client-ui-skill-library'
```

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部细节 — 点击展开</summary>

插件把原生 bridge 作为能力信号，注册本地化文案，再通过既有 slot 注册表贡献一个 `sidebar.footer.action` 配置项与一个 `shell.overlay` 配置项。目录请求通过类型化 bridge 投影；原生桌面壳负责网络请求、下载和审查流程。

| 文件 | 作用 |
|---|---|
| [`src/client/index.ts`](src/client/index.ts) | bridge 门禁、本地化注册与 slot 贡献 |
| [`src/client/bridge.ts`](src/client/bridge.ts) | 类型化 SkillHub 请求/回复词汇 |
| [`src/client/SkillLibraryOverlay.tsx`](src/client/SkillLibraryOverlay.tsx) | 筛选、目录行、分页与下载展示 |
| [`cordis.patch.yml`](cordis.patch.yml) | 内置 Web profile 使用的可移植组合配置项 |

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

- [macOS 桌面壳](../../../desktop-shell/README.zh.md) — 原生 bridge、生命周期与信任限制。
- [UI slot 系统](../ui-slots/README.zh.md) — 入口和 overlay 使用的类型化可追加注册机制。
- [Web 应用组合包](../../bundle/web-app/README.zh.md) — 挂载这个浏览器插件的组合。
- [插件库](../ui-plugin-library/README.zh.md) — 配套的插件发现与安装包。

-----

<a id="model-experience"></a>
## 模型体验

### SkillHub 目录浏览

#### 模型看到的内容

没有。这个组合包只贡献桌面 UI，不注册模型工具、提示词或提供方流量；`window.dshDesktopPluginBridge` 路径不进入模型上下文。

#### Token 影响

无；目录浏览和下载发生在模型请求之外。

#### KV Cache 影响

无；这个包不会组装或发送提供方请求。

## 已知限制与延后工作

<a id="known-limitations-and-deferred-work"></a>

- **暂不提供原生安装** — 这个包负责发现和下载 SkillHub package；独立的桌面壳能力负责审查并安装。
- **需要 bridge** — 普通浏览器没有特权桌面 bridge，因此这个包不会在那里注册可见界面。
- **依赖 SkillHub 可用性** — 目录结果和下载依赖 SkillHub 网络及其响应格式。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>面向维护者的工作上下文 — 点击展开</summary>

无。

</details>
