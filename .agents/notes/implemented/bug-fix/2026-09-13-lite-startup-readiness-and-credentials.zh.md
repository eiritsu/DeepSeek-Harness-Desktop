# Agent Note: Lite 启动就绪与凭据恢复

Status: implemented

[English](2026-09-13-lite-startup-readiness-and-credentials.md) | 中文

## Problem

DeepSeek Harness Lite 把 `dsh web:` URL 和对 `/plugins/__dsh_ready` 的请求作为先后两个就绪信号。Web profile 已不再注册该私有路由，并且只会在插件加载完成结算后输出 URL，因此健康的 Node host 会向重复探测返回 404，而壳一直停在“正在等待插件模块就绪”。旧数据迁移还可能沿用组内或其他用户可读的权限复制 `.credentials.yaml`，凭据 provider 会正确拒绝该文件。凭据文件格式错误时，界面只显示通用的提前退出提示，可恢复的原因只能在桌面日志中看到。

## Decision

Swift runtime 把带认证信息的 `dsh web:` URL 作为唯一的 host 就绪信号，不再发起第二次 HTTP 探测，直接让 WebView 导航。这遵循 Web profile 已有的生命周期保证，并把一次性认证 token 留给 WebView 请求。

旧数据迁移会把复制的 `.credentials.yaml` 权限收紧为 mode `0600`。凭据校验仍由 Node provider 负责，并继续快速失败。桌面启动错误会识别权限不安全、非 mapping 和 YAML 无效这三类诊断，只显示文件路径、适用时的 mode 和恢复操作；它不会包含凭据值或任意 stderr 文本。

## Alternatives considered

**恢复 `/plugins/__dsh_ready`。** 壳专用路由会重复 URL 输出已经承载的 loader 结算保证，并可能在共享 Web profile 再次变化时发生偏离。

**导航前探测已输出的根 URL。** URL 含有一次性进程 token，探测可能消耗原本留给 WebView 的认证请求。

**自动重写格式错误的凭据文件。** 标量或无效 YAML 文档不能可靠表明预期的凭据键。猜测可能破坏用户数据，或把密钥保存到错误的 provider；明确备份并重新录入可以恢复。

## Consequences

Lite 会在受支持的 host 启动信号出现后立即进入 Web client，不再等待不归壳所有的路由。复制的旧凭据文件会满足 provider 仅限所有者读取的权限要求。凭据内容无效时仍会阻止启动，直到操作方修复或移走文件，但应用现在会给出安全且可执行的说明。Swift 测试固定了 URL 驱动的就绪语义、权限收紧和凭据诊断脱敏行为。
