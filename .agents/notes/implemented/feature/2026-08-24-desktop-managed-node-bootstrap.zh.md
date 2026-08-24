# Agent Note: 为桌面应用引导受管理的 Node.js 工具链

Status: implemented

[English](2026-08-24-desktop-managed-node-bootstrap.md) | 中文

## Problem

桌面分发版会在首次启动时构建内置源码快照。要求每位用户手动安装 Node.js 会让 DMG 的启动准备不完整；把 Node.js 与完整 workspace 构建树都嵌入 DMG，则会显著增加每次下载体积，并在解压后重复占用运行时空间。

## Decision

桌面启动流程会先接受同一目录中的 `node` 与 `npx`，前提是 Node.js 版本满足仓库 engine 范围 `^22.19.0 || >=24.0.0`。如果不存在兼容工具链，应用会下载官方 Node.js 24.16.0 Darwin ARM64 归档，校验固定的 SHA-256 摘要，再安装到应用支持目录中的 `tools/node`。

源码准备、运行时启动、更新健康检查和插件命令会解析同一份工具链。受管理安装不需要管理员权限，不修改 shell 配置，也不会替换系统 Node.js。

## Alternatives considered

**把 Node.js 与全部构建运行时依赖嵌入 DMG。** 拒绝，因为 workspace 依赖树会显著增大磁盘映像，并在 App bundle 与解压源码缓存之间重复占用空间。

**通过 Homebrew 或系统软件包安装 Node.js。** 拒绝，因为这依赖外部包管理器、会修改系统状态，还可能要求与 Harness 无关的用户授权。

**接受任意可用 Node.js 可执行文件。** 拒绝，因为不受支持的 engine 版本可能在 pnpm 安装或运行时启动阶段失败，诊断位置会远离真实前置条件。

## Verification

桌面测试证明：兼容宿主工具链会跳过安装；缺少工具链时会在摘要校验后安装本地提供的归档；无效摘要不会留下受管理安装；接受的版本与仓库 engine 范围一致。

## Consequences

首次安装源码依赖仍需要联网；没有兼容宿主工具链时，下载受管理 Node.js 也需要联网。更新固定的 Node.js 归档时，桌面版本必须同时更新 URL 与摘要。
