# Agent Note：在操作提交点发布 profile 包映射

Status: implemented

[English](2026-10-05-profile-package-operation-publication.md) | 中文

## Problem

Plugin Manager 会在进程继续运行时修改 profile 的依赖清单和 bundle 选择。runtime 包表属于进程，因此新装 bundle 的私有依赖要等到包表重算后才能解析。若 bundle 的 Loader 条目停止前就移除映射，仍在运行的代码也会看到变化后的查询结果。

安装界面会先从一个注册表读取版本，再运行 pnpm。`minimumReleaseAge` 可能使 pnpm 安装另一个版本，但管理器此前不返回实际安装版本，界面一直只显示读取到的版本。

## Decision

### Runtime 映射发布

`ProfileRuntimeResolution` 保留构建一份不可变表所用的 installation anchor、Harness home 和 profile 目录。`PluginPackages.refresh()` 使用相同路径从磁盘重算后继版本，并通过 `replace()` 发布。以普通数据提供的 resolution 无法重算。

resolver 保持 installation 映射不变。在其插件停止后，可以删除 profile 映射和本地包名。保留的 profile 映射维持规范化目录、版本和作用域，但可将另一个仍选中的 bundle 记为声明包。profile 作用域不能变化，本地名称不能覆盖映射包，已发布的链接名不能指向另一个真实目录。发布操作替换一代及其缓存；它不会卸载模块或清除 Node 缓存（[generation 规则](2026-09-09-profile-resolution-generations.zh.md)）。

Plugin Manager 在保存 bundle 选择后、加载其条目前发布成功的新安装。覆盖已安装的包时保留当前映射表并返回 `restart-required`。启用时在 reload 前发布；停用时等 HMR 停止被移除的条目后发布。卸载时等 pnpm 成功并且受影响条目停止后发布。失败或取消的安装、失败的卸载都不发布。

没有 HMR 时，停用进程启动时就已启用的 bundle 不会停止其条目。只要有任何启动 bundle 仍处于停用状态，后续包操作就保留当前表。这会保留仍在运行的条目所用映射；卸载运行中的启动 bundle 仍会被拒绝（[管理生命周期](2026-09-14-current-profile-plugin-management.zh.md)）。

### 安装结果版本

如果 bundle manifest 声明了版本，`ChangeResult.version` 会携带实际安装版本。安装界面的包卡片显示此版本。当 registry subject 有已知名称和读取到的版本、pnpm 只询问了一个注册表、且实际安装版本不同时，界面会说明 pnpm 的 `minimumReleaseAge` 策略，并给出用于请求读取版本的精确 `name@version` spec。若运行回退到另一个注册表，则不推断版本差异的原因。安装流程及其现有回滚语义仍由[引导式插件安装](2026-09-15-guided-plugin-installation.zh.md)负责。

兼容基线维持 Harness `0.2.0-rc.2` 及现有 Cordis 与独立插件依赖。本次 backport 只改变 runtime 映射发布与实际安装版本报告，不采用 alpha 版本中无关的源码、API 或依赖改动。

## Alternatives considered

**每次查询都直接读取变化后的文件。** 新包路径会变得可见，但已加载模块和运行中的插件仍引用旧包实例。完整 runtime 表继续作为查询依据。

**先发布再停止已移除 bundle。** 运行中的插件可能在发布后继续导入模块并观察到不同的包表。因此管理器要等 HMR 完成条目卸载后再发布后继版本。

**把读取到的版本当作实际安装版本。** 版本由 pnpm 解析，release-age 策略可能使它选择另一个版本。结果报告实际 manifest 值；UI 仅在只询问了一个注册表时说明版本差异。

## Testing

`packages/boot/app-boot/tests/profile-resolution.spec.ts` 覆盖删除 profile 映射、修改其声明包以及保留 installation 限制。`profile-resolution-service.spec.ts` 覆盖刷新由代码计算的 installation-only resolution。`packages/boot/plugin-manager/tests/package-reload.spec.ts` 通过真实 Loader，在有无 HMR 时驱动安装、启用、停用、卸载、覆盖、失败和取消。`manager.spec.ts` 覆盖 manifest 版本存在和缺失两种情况。`packages/client/ui-plugin-manager/tests` 覆盖结果传递和单注册表版本差异提示。

## Consequences

新安装的私有依赖会在 bundle 条目加载前生效；只有对应运行条目停止后，删除的映射才会消失。若发布映射失败，成功的 pnpm 磁盘修改会保留，操作会报告应用失败；系统不会回滚已安装包。已加载模块和 Worker 会继续保留各自的包实例，直到重启。

可选字段 `ChangeResult.version` 会改变 pre-stable Plugin Manager Remote 类型。Typert/API 投影及面向模型的 API catalog 必须与源码一起重新生成。此 backport 不给 app-boot 增加运行依赖；plugin-manager 将 `chokidar` 作为直接 dev dependency，用于隔离文件监视器的生命周期测试。
