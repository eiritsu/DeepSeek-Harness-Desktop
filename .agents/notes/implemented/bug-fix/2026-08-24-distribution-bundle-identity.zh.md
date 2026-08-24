# Agent Note: 隔离桌面分发版身份

Status: implemented

[English](2026-08-24-distribution-bundle-identity.md) | 中文

## Problem

开发构建和分发构建共用同一个 bundle identifier。开发版启动后可能把绝对 checkout 路径保存为 `activeSourceRoot`，随后安装的分发版会继续使用该路径，而不是应用内置的源码快照。因此，发布版可能依赖本地源码状态，并表现出与全新安装不同的启动故障。

## Decision

分发构建使用 `ai.deepseek.harness.desktop`，开发构建保留 `ai.deepseek.harness.desktop.local`。DMG 打包门禁拒绝带有其他 identifier 的分发版。两个身份继续使用同一个 Application Support 目录保存 Harness profile 和会话数据，但负责选择源码根目录的 macOS 偏好设置相互隔离。

## Alternatives considered

**每次启动分发版时清除 `activeSourceRoot`。** 拒绝，因为分发版更新会合理地通过该偏好设置记录已暂存的源码版本。

**保留一个 identifier 并拒绝 checkout 路径。** 拒绝，因为无法仅凭任意绝对路径可靠地区分主动指定的源码与残留开发状态。

## Verification

分发打包命令会检查最终签名 App 的 bundle identifier，并确认没有 `DSHSourceRoot`。开发构建继续保留 `.local` identifier 和显式 checkout 路径。

## Consequences

安装分发版后不会再继承仅供开发使用的源码选择。Harness 数据的文件系统位置不依赖 bundle 偏好设置域，因此既有数据保持不变。
