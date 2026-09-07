---
kind: feature
status: implemented
---

# Windows desktop host

English | [中文](2026-09-07-windows-desktop-shell.zh.md)

The Windows desktop preview uses an Electron host with context isolation and Chromium WebView. It starts the built `dsh --profile web` runtime, loads its loopback URL, and keeps platform operations such as directory picking and external navigation in the host process. Product UI, MCP configuration, plugin management, credentials, and tool priority remain in the shared Web application.
