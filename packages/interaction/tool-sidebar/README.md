---
description: "Model-facing sidebar_open and browser_open tools for controlling the right sidebar and built-in browser in the GUI."
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-sidebar

English | [中文](README.zh.md)

## Summary

`@deepseek-ai/dsh-tool-sidebar` provides model-facing tools (`sidebar_open` and `browser_open`) and system prompt guidance to control and switch tabs in the GUI right sidebar, including the built-in Web browser, workspace file tree, terminal, and session inspector.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)

-----

<a id="use-this-package"></a>
## Use this package

Add this plugin to an agent preset's plugin list in `cordis.yml` or a preset patch:

```yaml
- id: tool-sidebar
  name: '@deepseek-ai/dsh-tool-sidebar'
```

### Registered Tools

1. `sidebar_open`: Switch the GUI right sidebar to a specific tab.
   - `tab`: `"browser"`, `"files"`, `"terminal"`, or `"session-inspector"`.
   - `target`: Optional URL (for browser) or workspace path (for files).

2. `browser_open`: Dedicated tool to navigate and open the sidebar browser.
   - `url`: Web page URL to navigate to (e.g. `https://example.com`).

<a id="understand-the-implementation"></a>
## Understand the implementation

The plugin registers two tools in `ctx.tools` and injects prompt text into `ctx.systemPrompt`. When the model calls either tool, the execution succeeds immediately and returns a message. The client-side UI (`@deepseek-ai/dsh-client-ui-sidebar-right`) listens for these tool call events on the session stream and opens or navigates the corresponding sidebar pane.

<a id="model-experience"></a>
## Model Experience

The system prompt section `tool:sidebar` informs the model about available GUI sidebar tabs and how to interact with the built-in browser and workspace files.
