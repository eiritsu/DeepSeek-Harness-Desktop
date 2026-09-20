# Agent Note：Lite 发行清单枚举 Computer Use 客户端包

Status: implemented

[English](2026-09-21-lite-distribution-computer-use-package.md) | 中文

## Problem

`desktop-lite` profile 将 `dsh-client-ui-computer-use` 挂载为 Computer Use 设置分区，但 Lite 发行清单只列出了原生提供方和共享服务。因此 RuntimeManifest 没有记录该客户端包的软件包条目或产物哈希，`package-dmg.sh` 也未审计其是否存在于源码快照中。即使 profile 声明了该分区，安装结果仍可能缺少它。Swift 外壳自身的清单也存在同样的缺口：源码更新会用缺少该包的上游树替换暂存包，插件清单没有列出它，profile 清理还会把该 client-only 名称写入 `dsh.profile.bundles`，从而被宿主加载器拒绝。

## Decision

[`build-app.sh`](../../../../desktop-shell/scripts/build-app.sh) 在 `packagePaths` 中列出 `packages/client/ui-computer-use`，因此 RuntimeManifest 会记录该包并对其构建后的 `lib` 计算哈希；构建产物检查也列出它，未构建时打包会失败。[`package-dmg.sh`](../../../../desktop-shell/scripts/package-dmg.sh) 在创建 DMG 前审计源码快照中的同一路径。快照的通用 `lib` 拷贝本就携带已构建产物；显式清单使遗漏能够使构建失败。

Swift 外壳在其三个清单中都列出同一包。[`SourceManager.swift`](../../../../desktop-shell/Sources/DeepSeekHarnessDesktop/SourceManager.swift) 的 `SourceManager.managedExtensionPaths` 包含 `packages/client/ui-computer-use`，因此会把应用自有包复制到更新暂存树上。[`PluginManager.swift`](../../../../desktop-shell/Sources/DeepSeekHarnessDesktop/PluginManager.swift) 的 `PluginManager.clientOnlyBundleNames` 包含 `@deepseek-ai/dsh-client-ui-computer-use`，它既是被报告为应用托管的嵌入清单，也是 `ensureManagedProfile` 在写入 `dsh.profile.bundles` 前剥离的清理清单。

## Alternatives considered

**仅依赖通用 `lib` 拷贝。** 快照会拷贝每个包的 `lib`，但 RuntimeManifest 和 DMG 审计读取显式清单，因此缺失或未构建的客户端包不会使打包失败。Swift 覆盖层同样只复制列出的路径，因此缺少该包的上游树会让更新后的源码丢失它。

**从 `desktop-lite` profile 推导清单。** 现有清单还列出了 profile 未挂载的基础 bundle 包，因此从 profile 推导会改变被记录和审计的包集合。

**在 Swift 中保留独立的嵌入清单与清理清单。** 两项都描述同一个 client-only 花名册，此前清理清单与嵌入清单的差异只是遗漏。现在由同一个 `clientOnlyBundleNames` 数组同时供给两处，因此新增客户端功能不会只更新其中一个清单而漏掉另一个。

## Verification

[`packages/bundle/desktop-lite/tests/distribution-packages.spec.ts`](../../../../packages/bundle/desktop-lite/tests/distribution-packages.spec.ts) 中的聚焦测试断言 profile 挂载 `@deepseek-ai/dsh-client-ui-computer-use`，且三个脚本清单都列出 `packages/client/ui-computer-use`。

[`desktop-shell/Tests/DeepSeekHarnessDesktopTests/ComputerUseInventoryTests.swift`](../../../../desktop-shell/Tests/DeepSeekHarnessDesktopTests/ComputerUseInventoryTests.swift) 通过窄内部接缝固定 Swift 清单：`SourceManager.overlayManagedExtensionPaths` 与 `overlayManagedExtensionsForTesting` 在固件树上驱动真实覆盖过程，`PluginManager.clientOnlyBundleInventory` 支撑一条清单断言和一条 profile 清理断言，后者验证该名称从不出现在 `dsh.profile.bundles` 中。

## Consequences

当 Computer Use 客户端包缺失或未构建时，Lite 发行打包现在会失败，且其 RuntimeManifest 软件包记录与随附 profile 一致。源码更新会保留应用自有包，插件清单将其呈现为内置且不可移除，清理也无法把它写为 profile bundle。
