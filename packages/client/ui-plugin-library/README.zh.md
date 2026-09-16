---
description: "Swift 与 Electron 桌面壳共享的插件发现、不可变来源审查、安装、移除与审计界面。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-plugin-library

[English](README.md) | 中文

## 概述

`dsh-client-ui-plugin-library` 在 Swift 或 Electron 桌面壳公开 `window.dshDesktopPluginBridge` 时增加插件管理入口和覆盖层。它列出内置 Bundle 与树外依赖、发现社区项目、审查不可变或本地来源，并把通过审查的变更委托给所属桌面壳。安装的插件依赖保存在桌面壳自有 profile 中，共享 Skill 数据仍位于 `DSH_HOME`。普通浏览器使用相同 Web 组合，但由于不存在特权 bridge，这个包不会注册任何界面。来源审查是安装预检，不是沙箱或发布者背书。

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

随附的 Web 应用会挂载这个包，但它只在受支持的桌面壳内可见。从侧边栏底部或 Electron 应用菜单打开“插件库”，即可检查 profile 依赖、查询公共 npm 更新、审查来源、移除依赖或读取桌面壳审计日志。已安装工具栏保持可见，卡片列表在覆盖层内部滚动。

### 审查并安装来源

审查接受精确 npm 版本、固定到 commit 的 HTTPS GitHub 仓库或本地目录。可直接安装的来源必须具有有效根 package manifest，并由 `dsh.bundle.patch` 指向实际存在的包内 YAML 入口。插件如果拥有用户设置，可以在 `dsh.settings.namespaces` 中声明小写连字符 namespace；卸载时只删除这些声明的配置段，并保留未声明的配置。桌面壳 bridge 会签发一个有效期 15 分钟的一次性审查 token，再以精确来源且禁用依赖 lifecycle script 的方式安装到其受管 profile。

社区发现使用 [SkillHub Plugins 目录](https://skillhub.cloud.tencent.com/plugins)与 GitHub 的 `dsh-plugin` topic。目录元数据只用于发现；选中的 GitHub 仓库会先固定到 commit，再通过结构审查后才能安装。

### 挂载到其他 Web 组合

把浏览器插件作为普通 Cordis 配置项挂载即可。它没有公开配置字段，并且在 document-start bridge 不存在时保持休眠。

```yaml
- name: '@deepseek-ai/dsh-client-ui-plugin-library'
```

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部细节 — 点击展开</summary>

插件把桌面 bridge 作为能力信号，注册本地化文案，再通过既有 slot 注册表贡献一个 `sidebar.footer.action` 配置项与一个 `shell.overlay` 配置项。两个贡献通过同一个控制器共享覆盖层可见状态，Electron 应用菜单会分发同一个控制器事件。所属桌面壳负责固定来源、检查 package、执行命令、持久化审计记录和重启；浏览器代码只负责展示及类型化请求/回复投影。

本包不发布 runtime invariant companion，因为 bridge 是否存在和浏览器本地 UI 状态之间不存在可独立观察的运行时关系。

| 文件 | 作用 |
|---|---|
| [`src/client/index.ts`](src/client/index.ts) | bridge 门禁、本地化注册与 slot 贡献 |
| [`src/client/bridge.ts`](src/client/bridge.ts) | 类型化原生请求/回复词汇 |
| [`src/client/PluginLibraryOverlay.tsx`](src/client/PluginLibraryOverlay.tsx) | 已安装列表、审查、发现与审计展示 |
| [`cordis.patch.yml`](cordis.patch.yml) | 与内置 Web 配置项一致的可移植组合配置项 |

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

- [macOS 桌面壳](../../../desktop-shell/README.zh.md) — Swift bridge、生命周期、更新与信任限制。
- [Electron 桌面壳](../../../apps/desktop/README.zh.md) — 跨平台 bridge、打包与受管 profile 行为。
- [UI slot 系统](../ui-slots/README.zh.md) — 入口和覆盖层使用的类型化可追加注册机制。
- [Web 应用组合包](../../bundle/web-app/README.zh.md) — 挂载这个浏览器插件的组合。
- [插件命令](../../../apps/cli/reference/README.zh.md) — 桌面壳委托的 profile 依赖生命周期。

-----

<a id="model-experience"></a>
## 模型体验

### 桌面插件管理

#### 模型看到的内容

无。`window.dshDesktopPluginBridge` 能力只贡献桌面管理 UI，不注册模型工具、提示词或 provider 流量。

#### Token 影响

无；插件发现与安装发生在模型请求之外。

#### KV Cache 影响

无；这个包不会组装或发送提供方请求。

## 已知限制与延后工作

<a id="known-limitations-and-deferred-work"></a>

以下限制界定桌面安装器的信任与兼容范围。

- **不提供运行时隔离** — 结构审查、不可变来源固定和禁用 lifecycle script 都不会限制已启用插件的文件、网络、进程或凭据访问能力。
- **没有 package 级启停开关** — 激活状态属于 Cordis 配置项，而一个 npm package 可以贡献多个配置项。
- **依赖 lifecycle 的 package 可能失败** — 需要 `prepare` 或其他依赖 lifecycle script 的 package 可能无法通过这个安装路径工作。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>面向维护者的工作上下文 — 点击展开</summary>

无。

</details>
