# Agent Note：等待桌面 Web bundle 就绪后再打开 WebView

Status: implemented

[English](2026-09-03-desktop-web-readiness-race.md) | 中文

## Problem

桌面运行时在 HTTP 监听器绑定后立即打印本地地址，但 client module registry 可能仍在生成第一个 combo 响应。这样 WebView 偶尔会在短暂的 404 窗口内请求该地址，并永久显示插件启动失败页面。

## Decision

运行时打印地址后，桌面壳会轮询客户端模块 registry 所有的免认证就绪路由，然后才把带一次性 token 的地址交给 WKWebView。如果 registry 一直没有就绪，则在有界等待后报告明确的启动失败。

## Alternatives considered

**在打开 WebView 前增加固定 sleep。** 固定延迟在快速机器上会徒增等待时间，在负载较高时又可能不够，而且无法观察真实的就绪条件。

**等 WebView 显示错误后再重试。** 此时 module loader 已经丢失初始启动状态；在服务公布有效 bundle 后再导航，可以把这类失败挡在界面之外。

## Consequences

首次桌面导航现在会在客户端模块路由注册且组合 bundle 响应可用后才开始。探针调用不带 process token 的 `/plugins/__dsh_ready`，把一次性 token 保留给 WKWebView 完成 cookie 交换。registry 生成期间启动可能增加几百毫秒等待，但短暂的 bundle 404 不会再变成永久插件加载失败。

原生测试覆盖不消费 token 的就绪 URL 及客户端模块就绪路由；现有 Swift 测试套件继续作为生命周期和打包的聚焦门禁。
