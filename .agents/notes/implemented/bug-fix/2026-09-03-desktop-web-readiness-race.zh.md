# Agent Note：等待桌面 Web bundle 就绪后再打开 WebView

Status: implemented

[English](2026-09-03-desktop-web-readiness-race.md) | 中文

## Problem

桌面运行时在 HTTP 监听器绑定后立即打印本地地址，但 client module registry 可能仍在生成第一个 combo 响应。这样 WebView 偶尔会在短暂的 404 窗口内请求该地址，并永久显示插件启动失败页面。

## Decision

运行时打印地址后，桌面壳会轮询带认证的启动页面，提取页面公布的 combo URL，并等待该 bundle 返回 HTTP 200，然后才把地址交给 WKWebView。如果 registry 一直没有就绪，则在有界等待后报告明确的启动失败。

## Alternatives considered

**在打开 WebView 前增加固定 sleep。** 固定延迟在快速机器上会徒增等待时间，在负载较高时又可能不够，而且无法观察真实的就绪条件。

**等 WebView 显示错误后再重试。** 此时 module loader 已经丢失初始启动状态；在服务公布有效 bundle 后再导航，可以把这类失败挡在界面之外。

## Consequences

首次桌面导航现在会在服务公布启动 HTML 和至少一个 client combo 后才开始。探针使用同一个带认证的本地地址，并检查浏览器实际使用的带 revision 的 `/plugins/??...&rev=...` 资源。registry 生成期间启动可能增加几百毫秒等待，但短暂的 bundle 404 不会再变成永久插件加载失败。

原生测试覆盖启动页面中 combo URL 的 HTML 实体解码；现有 Swift 测试套件继续作为生命周期和打包的聚焦门禁。
