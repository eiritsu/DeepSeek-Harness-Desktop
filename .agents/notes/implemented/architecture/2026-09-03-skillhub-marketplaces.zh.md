# Agent Note: SkillHub 桌面市场

Status: implemented

[English](2026-09-03-skillhub-marketplaces.md) | 中文

## Problem

桌面侧边栏原来只有插件市场，可复用技能只能通过面向模型的技能运行时获得。插件发现还暴露多个社区目录，各自的审查语义不同，用户看到的来源可能与安装前实际检查的来源不一致。

## Decision

Web bundle 现在加载独立的 `@deepseek-ai/dsh-client-ui-skill-library` Cordis 包。在带有 document-start bridge 的桌面页面中，它在“插件库”上方注册“技能库”入口和 shell overlay；主 tab 与插件库对齐为“已安装”“审查安装”“社区发现”“操作日志”。“社区发现”映射 SkillHub 技能 endpoint，内部控件按 SkillHub 页面布局提供排序 tab、来源/场景/API Key 筛选、整行搜索框和单列结果行。overlay 使用 SkillHub 列表 API，滚动保持在内部 viewport，接近底部时预加载下一页，并提供上一页/下一页和“加载更多”控件。技能卡片链接到 SkillHub 并下载发布的 ZIP；将 ZIP 写入本地技能目录的能力留给后续独立原生能力。

插件库的社区发现现在只使用 SkillHub Plugins。原生审查会先把每个条目提供的 GitHub 仓库固定到 commit，再复用现有 DSH Bundle 结构检查和安装 token 流程。原来的 GitHub Topic 和第三方目录 UI 路径不再对用户暴露。

## Alternatives considered

**用 iframe 嵌入 SkillHub 页面。** 放弃，因为应用需要自己控制内部滚动、翻页、加载状态、仓库链接和安全提示；投影 API 更适合桌面壳。

**把市场并入已有的斜杠技能引用包。** 放弃，因为斜杠引用服务于模型和会话，而市场是桌面管理界面，生命周期和安装所有权不同。

**继续保留多个插件社区目录。** 放弃，因为多个目录重复分页和审查入口，容易暗示不同的安装保证。SkillHub Plugins 作为唯一发现来源，本机审查仍是最终依据。

## Consequences

桌面 distribution 多携带一个 client bundle 和一个默认侧边栏入口。SkillHub 不可用时只显示本地化加载错误，不影响 agent loop。技能 ZIP 安装、签名校验和运行时隔离仍是明确的后续工作；插件安装继续依赖现有原生审查 token 和固定来源。

## Verification

插件工作区通过 client TypeScript 构建、插件库组件测试（8 项）和完整 macOS desktop-shell Swift 测试（30 项）。Harness 工作区已对新 client 包进行类型检查，并把它纳入 Web bundle 依赖图和 Cordis patch。
