# Agent Note: 桌面 Application Support 数据与插件管理

Status: implemented

[English](2026-09-03-desktop-application-support-data-and-plugin-management.md) | 中文

## Problem

macOS 桌面壳使用 Application Support 下的 Harness home，而早期桌面运行把持久数据写在 `~/.dsh`。插件库此前只读取 profile 依赖，因此即使内置插件和技能库已经加载，已安装数量仍不会显示它们。

## 决策

桌面壳统一使用 `~/Library/Application Support/DeepSeek Harness Desktop/data` 保存会话、设置、profile、插件依赖和技能数据。首次启动会把 `~/.dsh` 中缺失的数据合并进来；旧设置和 workspace 状态优先于新建的 onboarding 文件；旧目录保留不删除，并写入迁移标记保证幂等。

Shell 会在运行时启动前建立 `data/dsh-desktop.sqlite`。数据库保存 schema 版本、旧版持久化文件的完整清单，以及 settings、凭据、workspace、会话、profile、插件、技能、model catalog、审计记录和源码版本的目标表。session、settings、credentials、storage unit、profile／Skill 元数据、插件审计记录和 source-release 记录已经在运行时使用 SQLite。由于 Loader 和 Skill provider 需要直接执行，profile manifest 与 Skill 源仍是文件制品；旧版审计 JSONL 仅作为兼容导出保留。

桌面 Web profile 仅在 `DSH_DESKTOP_SHELL=1` 时挂载面向模型的会话查询消费方。全文索引会在 `data/dsh-session-query.sqlite` 延迟打开，并从权威会话持久化服务派生。跨会话读取要求 Workspace 完全一致；模型不会得到不受限制的数据库或文件系统搜索界面。

Session 导出仍通过已认证的 loopback 路由流式输出。macOS shell 接管 WebKit 下载导航，并在用户 Downloads 目录中以不重名文件名保存归档，因此面向浏览器的 client 操作不会跳到外部浏览器，也不会在没有文件时报告成功。运行时输出在追加到桌面日志前会脱敏包含凭据的字段和认证查询参数，shell 启动时也会对现有日志执行相同的脱敏。

插件库把随应用提供的 Web profile Bundle 显示为 App 管理项，把外部 profile 依赖显示为可卸载项。以后从桌面安装外部插件仍通过 `dsh plugin --profile web` 执行，并把 `DSH_HOME` 指向 Application Support 数据目录。启动时会把嵌入源码快照中实际存在的内置 Bundle 加入持久 Web profile，不替换用户依赖。

## 验证

桌面 Swift 测试覆盖旧 home 合并且不删除旧数据，以及 App 内置 Bundle 的插件清单。Bundle 组合测试会分别计算普通 Web 与桌面会话查询设置。打包 App 的 smoke 测试会验证 Session 日志操作在 Downloads 产生并通过校验的 ZIP。插件库 locale 与包文档说明 Application Support 的数据归属，以及内置项和可卸载项的区别。

## 备选方案

继续把 `~/.dsh` 作为桌面 home 会让桌面运行时文件和其他 Harness 调用混在一起，也无法提供 App 自己管理插件的目录。迁移时删除旧 home 可能造成不可逆的数据丢失，因此实现为复制并保留旧目录。

## 后果

替换应用二进制后不需要用户手工搬运插件或技能数据。旧 home 作为恢复副本保留；之后通过桌面 UI 的写入不会回写旧目录。App 管理的内置 Bundle 不走外部插件卸载流程，外部依赖仍遵循现有审查和审计路径。

桌面模型请求会多携带五个只读会话历史 schema。派生全文索引可以删除并重建，不会丢失会话数据。普通浏览器、TUI 和 headless profile 仍保留之前的 opt-in 行为。
