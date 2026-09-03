# Agent Note: 隔离桌面 loopback 浏览器 Cookie

Status: implemented

[English](2026-09-03-desktop-loopback-cookie-isolation.md) | 中文

## Problem

桌面壳会在多次启动时复用不同的 loopback 端口，但 shared URL session 与 WebView cookie store 会保留按 loopback 主机记录的 cookie。累积的 cookie 可能超过本地服务器的请求 header 限制，在读取 Web profile 或 client bundle 前返回 HTTP 431，最终让桌面窗口显示白屏。

## Decision

就绪探针使用禁用 cookie store 的 ephemeral URL session，因为 `/plugins/__dsh_ready` 不需要认证，也不能消耗浏览器会话状态。WebView 使用 non-persistent website data store，使每次 App 运行拥有隔离的浏览器会话，同时保留本次运行内一次性启动令牌交换所签发的 cookie。更新健康检查也使用新的 ephemeral session，不再使用进程级 shared session。

## Alternatives considered

**每次启动清空 shared cookie store。** 清空全局存储可能删除其他本地 Web 客户端拥有的数据，并且仍让桌面壳依赖 shared mutable state。

**提高本地服务器的 header 限制。** 更大的限制只会掩盖无界的旧 cookie 累积，不能消除跨运行会话污染。

**保留持久化 WebView 存储，只轮换启动 URL。** 启动令牌虽然会变化，但旧 cookie 仍会附着在后续动态 loopback 端口上，依然可能阻止根请求到达认证逻辑。

## Consequences

桌面健康探针与内嵌 WebView 不再继承之前 loopback 端口的 cookie，从而避免 HTTP 431 白屏故障。本次运行签发的 cookie 会继续供本次运行的 WebView 调用已认证 API。持久化会话、设置、凭据、插件和 Skill 仍由桌面数据存储负责；浏览器会话数据明确按运行隔离。

聚焦 Swift 测试覆盖 WebView data store 策略、启动令牌 URL 处理、就绪轮询和启动生命周期。已从重新构建的 App bundle 执行 distribution 冷启动：Web profile 成功显示侧栏和输入区，`/plugins/__dsh_ready` 返回 HTTP 204。
