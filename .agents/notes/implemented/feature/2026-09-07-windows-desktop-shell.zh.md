---
kind: feature
status: implemented
---

# Windows 桌面壳

[English](2026-09-07-windows-desktop-shell.md) | 中文

Windows 桌面预览使用启用 context isolation 的 Electron 宿主和 Chromium WebView。宿主启动已构建的 `dsh --profile web` 运行时并加载 loopback 地址，同时把目录选择和外链打开等平台操作保留在宿主进程。产品 UI、MCP 配置、插件管理、凭据和工具优先级继续由共享 Web 应用提供。
