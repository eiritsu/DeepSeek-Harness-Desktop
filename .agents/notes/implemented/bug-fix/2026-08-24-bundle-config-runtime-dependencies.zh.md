# Agent Note: 保持 bundle 配置插件进入运行时依赖闭包

Status: implemented

[English](2026-08-24-bundle-config-runtime-dependencies.md) | 中文

## Problem

Profile Bundle 可以只通过 `cordis.patch.yml` 插入插件，因此 TypeScript import 分析看不到这项关系。如果从 bundle 的生产依赖中删除该插件，source-plane 测试仍可能通过，而构建后的桌面应用会在 plain Node 下启动失败。Profile 模块 fallback 只链接已安装 CLI 依赖图中可达的包；缺少仅由配置引用的依赖时，Loader 会在 Web 界面就绪前退出。

## Decision

Profile Bundle patch 插入的每个非自身 bare package 都是该 bundle 的生产依赖。`verify-cordis-config` 强制校验这项 manifest 关系。仅由配置引用的依赖使用包级 `knip` 例外，因为它的运行时用途来自 YAML 引用，而不是 TypeScript import。

构建后的 Web CLI 兼容性冒烟测试会从全新的 Harness home 启动正式 Profile，并在接受启动成功前确认共享 Profile fallback 包含 `Deepseek-Files` 设置插件。该路径与发布版 macOS 应用使用的 plain-Node 解析路径一致。

## Alternatives considered

**把默认插件安装进每个用户 Profile。** 拒绝，因为安装自带的 bundle 属于应用依赖闭包。改写 Profile 依赖会混合内置包和用户管理的侧载插件，并要求每次应用升级都执行迁移。

**在 CLI 上直接声明设置插件。** 拒绝，因为文件识别 bundle 拥有该插件 row，也应携带其 patch 所需的全部包。CLI 重复声明依赖会掩盖一个无效的独立 bundle manifest。

## Verification

如果 bundle patch 的非自身 package 没有出现在生产依赖中，Cordis 配置门禁会拒绝它。构建态 Web CLI 兼容性冒烟测试在 plain Node 下启动完整正式 Profile，并检查 `@deepseek-ai/dsh-client-ui-deepseek-files` 的模块 fallback 链接。

## Consequences

应用升级会把新的内置包修复进共享 fallback，同时保留既有 Profile 的用户依赖和 bundle 顺序。仅由配置引用的运行时依赖需要显式 `knip` 例外，并由 Cordis 配置门禁证明该例外的原因。
