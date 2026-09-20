# 计算机操作

[English](computer-use.md) | 中文

计算机操作让模型通过配置的提供方观察并操作本地桌面。DSH 的共享能力称为 **computer use（计算机操作）**；**Cua Driver** 是上游实现的名称。

## 选择提供方

在同一组合中挂载 [`dsh-computer-use`](../../packages/computer-use/computer-use/README.zh.md) 和一个提供方。Desktop 与 Lite 产品默认挂载原生提供方；其他 profile 需显式选择提供方。

| 提供方 | 运行时 |
|---|---|
| [Cua Driver 原生](../../packages/computer-use/cua-driver-native/README.zh.md) | 随 npm 依赖安装的平台原生运行时；由 Desktop 与 Lite 产品挂载 |
| [Cua Driver MCP](../../packages/experimental/computer-use-cua-driver-mcp/README.zh.md) | 通过 MCP 连接已安装的 `cua-driver` 可执行文件；实验性且需显式启用 |

各提供方提供上游工具目录。共享服务只注册名称，并拒绝任何第二个提供方，包括使用相同名称的另一个实例。服务不包含通用桌面操作方法或模型控制的选择器。

## 生命周期和桌面共享

提供方在关闭工具和自有资源期间保留注册。启动失败会释放此次尝试的注册。MCP 提供方在重连期间保留注册。原生提供方拥有持久化的 `enabled` 设置，并以 [`dsh-client-ui-computer-use`](../../packages/client/ui-computer-use/README.zh.md) 贡献的一级**电脑操作**设置分区呈现；将其关闭会拆除运行时、中止进行中的调用并释放注册，将其开启会重新初始化运行时。该分区仅在组合提供提供方设置命名空间时渲染。

一个已注册的提供方不会为某个 Session 预留桌面。调用方负责协调跨 Session 和独立 DSH 进程的完整观察、操作和验证流程。取消调用无法撤销桌面已收到的输入。

## 结果和平台要求

工具使用常规执行流程和 Session 日志。支持图像的模型路由在挂载附件存储时接收持久化截图；不支持图像的路由接收现有 MCP 图像诊断。提供方 README 负责说明安装、权限和平台限制。macOS 上由用户向启动应用授予桌面权限；Windows 需要交互式桌面会话。普通 headless CLI profile 不挂载任何提供方。

[决策记录](../../.agents/notes/implemented/architecture/2026-09-12-computer-use-provider-registration.zh.md)解释只负责注册的服务和两个 Cua Driver 集成。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxcomputeruse--computeruseregistry"></a>

### `ctx.computerUse` — `ComputerUseRegistry`

Owns one optional provider registration in the shared computer-use service.

```ts cordis-catalog
/**
 * Reserve the sole provider slot until the contribution is disposed.
 * A second registration fails even when it repeats the current name. Providers
 * must stop their tools and await owned work before releasing this registration.
 * @param name - provider-owned name used in registration diagnostics.
 * @returns the effect disposer for this exact registration.
 */
register(name: ComputerUseProviderName): () => Promise<void>
```

Source: [`packages/computer-use/computer-use/src/index.ts`](../../packages/computer-use/computer-use/src/index.ts)
<!-- END GENERATED cordis-surface -->
