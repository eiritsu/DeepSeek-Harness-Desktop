---
description: "面向模型的 sidebar_open 与 browser_open 工具，用于在 GUI 中控制右侧侧边栏与内置浏览器。"
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-sidebar

[English](README.md) | 中文

## 摘要

`@deepseek-ai/dsh-tool-sidebar` 提供面向模型的工具（`sidebar_open` 与 `browser_open`）及系统提示词引导，用于在 GUI 中切换与控制右侧侧边栏面板，包括内置网页浏览器、工作区文件树、终端和会话诊断日志。

## 目录

- [使用此包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [模型体验](#model-experience)

-----

<a id="use-this-package"></a>
## 使用此包

在 `cordis.yml` 或预设补丁的 Agent 预设插件列表中添加此插件：

```yaml
- id: tool-sidebar
  name: '@deepseek-ai/dsh-tool-sidebar'
```

### 注册的工具

1. `sidebar_open`：将 GUI 右侧侧边栏切换到指定面板。
   - `tab`：`"browser"`、`"files"`、`"terminal"` 或 `"session-inspector"`。
   - `target`：可选的 URL（针对浏览器）或工作区文件相对路径（针对文件树）。

2. `browser_open`：专门用于打开并导航侧边栏内置浏览器的工具。
   - `url`：要导航并展示的网页 URL（例如 `https://example.com`）。

<a id="understand-the-implementation"></a>
## 理解实现

该插件在 `ctx.tools` 中注册两个工具，并在 `ctx.systemPrompt` 中注入系统提示词。模型调用任一工具时，执行立即成功并返回结果信息。客户端 UI（`@deepseek-ai/dsh-client-ui-sidebar-right`）在会话事件流上监听这些工具调用事件，并联动打开或导航对应的侧边栏面板。

<a id="model-experience"></a>
## 模型体验

系统提示词小节 `tool:sidebar` 向模型介绍 GUI 右侧侧边栏的可用面板，以及如何与内置浏览器和工作区文件进行交互。
