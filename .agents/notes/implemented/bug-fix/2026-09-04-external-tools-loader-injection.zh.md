# Agent Note: external-tools 保留 Loader 注入元数据

Status: implemented

[English](2026-09-04-external-tools-loader-injection.md) | 中文

## 问题

`dsh-external-tools` 是导出 `name`、`inject` 与 `apply` 的命名空间插件。若模块同时提供默认导出，DSH Loader 会把模块折叠为默认值，丢弃依赖注入元数据。凭据未配置时，外部工具注册路径不会访问 `ctx.tools`，所以该错误只会在用户保存第一个 API Key 后暴露。

## 决策

`dsh-external-tools` 只保留命名空间插件导出，不提供默认导出。Loader 回归测试通过真实 `unwrapExports` 检查 `name`、`inject` 和 `apply` 仍完整存在。宿主插件因此会在 `tools` 与 `credentials` 都可用时激活，保存凭据后可注册对应工具，不会使运行时连接失效。

## 考虑过的替代方案

**给默认类增加静态 `inject`。** 被拒绝，因为 Loader 仍会丢弃命名空间的其他元数据，并让同一包存在两种入口语义；命名空间插件的单一入口更明确。

**在 `reconcile()` 中捕获缺失的 `ctx.tools`。** 被拒绝，因为这会把 Loader 组合错误伪装成凭据状态，工具不会注册且错误会在后续重复出现。应在模块导出形状处修复注入元数据。

## 后果

保存 Tavily 或其他外部工具凭据后，Host 会继续运行并注册已实现的提供方工具；前端凭据描述刷新可以收到正常响应。新增命名空间插件时必须避免添加会触发 Loader 折叠的默认导出，并由 Loader-path 测试固定这一点。
