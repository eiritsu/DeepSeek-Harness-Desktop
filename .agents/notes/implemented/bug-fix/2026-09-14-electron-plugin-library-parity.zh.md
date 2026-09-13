# Agent Note：Electron 插件库对齐

状态：已实现

[English](2026-09-14-electron-plugin-library-parity.md) | 中文

## 问题

Electron 使用独立的旧插件管理窗口，只接受一个 npm package 字符串，也不呈现 Lite 使用的共享审查、发现与审计体验。因此 Windows 构建看起来像丢失了插件库。桌面壳在请求结束前重启时，安装还可能让共享覆盖层一直处于忙碌状态；Lite 的辅助 SQLite 镜像也会在 profile manifest 已移除依赖后继续把它标记为已安装。

## 决策

Electron 现在公开 `dsh-client-ui-plugin-library` 所使用的同一个 `dshDesktopPluginBridge`。侧边栏入口与应用菜单打开同一个共享覆盖层。Electron 实现已安装及内置清单、npm 更新审查、GitHub topic 与 SkillHub 发现、固定 commit 的 GitHub 审查、精确 npm 审查、本地目录审查、一次性审查 token、持久化审计记录，以及受管 profile 的安装与移除。

Bridge 只接受经过校验的结构化请求。远程 manifest 受响应大小与重定向限制。可安装 package 必须通过 `dsh.bundle.patch` 指向实际存在的包内入口；依赖 lifecycle script 继续禁用。Electron profile 接受精确 registry 版本、完整 GitHub commit 和实际存在的本地目录引用，同时继续拒绝包管理器 flag 与宿主持有的 package。

Electron 在变更请求完成后才安排应用重新加载，共享覆盖层通过 `finally` 清除忙碌状态。Lite 强制同步 payload 时，先把所有来自 profile 的插件镜像项标记为已移除，再把当前 manifest 中实际观察到的依赖恢复为已安装。

## 考虑过的替代方案

**保留 Windows 专用旧窗口。** 未采用，因为它重复实现产品行为，并永久缺少来源审查、社区发现、审计历史和内置清单。

**安装任意包管理器 spec。** 未采用，因为 tag、branch、tarball 和命令行 flag 都不提供不可变且经过审查的来源。

**删除陈旧的 SQLite 插件行。** 未采用，因为辅助 catalog 同时用于审计与迁移清单。`removed` 状态可以保留历史，又不会把该行呈现为当前安装。

## 结果

Swift 与 Electron（包括 Windows）呈现同一个插件库客户端，并把各桌面壳特有的 package 执行隐藏在范围受限的 bridge 后。内置兼容 package 可见但不可移除。失败操作会显示错误而非永久转圈；成功操作只在渲染进程收到完成结果后重新加载应用。

共享审查属于结构检查，不是运行时沙箱。依赖 lifecycle script 的插件仍可能按设计失败。聚焦的 TypeScript、Electron、浏览器与 Swift 测试覆盖请求校验、不可变来源安装、菜单打开、忙碌状态恢复与陈旧镜像协调。
