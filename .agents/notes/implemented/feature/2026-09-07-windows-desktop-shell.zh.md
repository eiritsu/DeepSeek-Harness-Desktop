# Agent Note: Windows 桌面预览壳

Status: implemented

[English](2026-09-07-windows-desktop-shell.md) | 中文

## Problem

桌面分支最初只有 Swift macOS 壳。Windows 用户需要一个复用 Web 应用、又不会创建第二套产品 UI 的可执行预览。

## Decision

`desktop-shell-windows` 使用启用 Electron context isolation 的 Chromium renderer，实现了分支早期的 Windows 预览。它启动已构建的 `dsh --profile web` 运行时、加载 loopback URL，并把目录选择与外部导航保留在 host 进程。产品 UI、MCP 配置、插件管理、凭据和工具优先级继续由共享 Web 应用提供。

当前上游生产 Desktop 已位于 `apps/desktop` 与 `apps/desktop-host`，不会使用此预览壳。[桌面分支 Electron 迁移提案](../../proposed/architecture/2026-09-13-desktop-fork-electron-migration.zh.md)负责其退役与功能映射。

## Alternatives considered

**构建原生 Windows UI。** 这会重复 Web 界面，并让平台行为进一步偏离 Swift macOS 壳。

**等待 macOS 壳变得可移植。** Swift AppKit 与 WebKit 不提供 Windows 运行时，因此这不会产生 Windows 预览。

## Consequences

分支通过同一套 Web UI 获得了 Windows 预览，但该预览仍保留 loopback server、源码部署和独立打包路径。它只是历史迁移输入，不是生产 Desktop 架构或经过质量验证的发行目标。
