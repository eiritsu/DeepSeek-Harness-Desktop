# Agent Note：Lite 窗口命中测试与动态状态重置

Status: implemented

[English](2026-09-18-lite-window-and-dynamic-reset.md) | 中文

## Problem

Lite 标题栏遮罩位于原生 titlebar 容器中时，可能在 WebKit 收到点击前拦截工具栏事件。DSH 连接重置后，浏览器端还可能保留上一个 Host 进程的动态插件状态，并继续请求已经不存在的插件 ID。

## Decision

Lite 拖拽视图现在位于 content 层级，作为全宽、固定高度的覆盖层。它只接管安全拖拽区域，其余位置穿透到 WebKit。该区域继续支持原生拖拽、双击缩放，并随窗口宽度自适应排除区域。

Client dynamic package runner 和 run orchestrator 现在在 `connection/reset` 时清理页面级动态包、审批、失败状态和旧的 in-flight generation。重置前启动的异步工作不能在重置后回答或发布状态。

## Alternatives considered

**继续把遮罩放在原生 titlebar，并扩大排除矩形。** 不采用，因为父级命中测试仍可能在 WebKit 收到事件前吞掉事件。

**在重连后保留动态插件。** 不采用，因为 Plugin ID 只在进程内有效，新 Host 不一定拥有旧注册表条目。

## Verification

Swift package tests 已通过，包含 Lite 标题栏几何测试。Client runner 和 orchestrator 测试覆盖重置清理、后续重新加载以及禁止旧异步操作晚到回答。

## Consequences

工具栏保持可交互，同时标题栏仍支持拖拽和缩放。重连会清理临时动态 UI 状态；现有 inventory reset 流程会重新读取 Host 的权威清单。
