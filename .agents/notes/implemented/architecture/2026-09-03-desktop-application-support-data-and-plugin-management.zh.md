# Agent Note：桌面 Application Support 数据与插件管理

状态：已实现

[English](2026-09-03-desktop-application-support-data-and-plugin-management.md) | 中文

## 问题

macOS 桌面壳使用 Application Support 下的 Harness home，而早期桌面运行把持久数据写在 `~/.dsh`。插件库此前只读取 profile 依赖，因此即使内置插件和技能库已经加载，已安装数量仍不会显示它们。

## 决策

桌面壳统一使用 `~/Library/Application Support/DeepSeek Harness Desktop/data` 保存会话、设置、profile、插件依赖和技能数据。首次启动会把 `~/.dsh` 中缺失的数据合并进来；旧设置和 workspace 状态优先于新建的 onboarding 文件；旧目录保留不删除，并写入迁移标记保证幂等。

Shell 会在运行时启动前建立 `data/dsh-desktop.sqlite`。数据库保存 schema 版本、旧版持久化文件的完整清单，以及 settings、凭据、workspace、会话、profile、插件、技能、model catalog、审计记录和源码版本的目标表。session、settings、credentials、storage unit、profile／Skill 元数据、插件审计记录和 source-release 记录已经在运行时使用 SQLite。由于 Loader 和 Skill provider 需要直接执行，profile manifest 与 Skill 源仍是文件制品；旧版审计 JSONL 仅作为兼容导出保留。

插件库把随应用提供的 Web profile Bundle 显示为 App 管理项，把外部 profile 依赖显示为可卸载项。以后从桌面安装外部插件仍通过 `dsh plugin --profile web` 执行，并把 `DSH_HOME` 指向 Application Support 数据目录。启动时会把嵌入源码快照中实际存在的内置 Bundle 加入持久 Web profile，不替换用户依赖。

## 验证

桌面 Swift 测试覆盖旧 home 合并且不删除旧数据，以及 App 内置 Bundle 的插件清单。插件库 locale 与包文档说明 Application Support 的数据归属，以及内置项和可卸载项的区别。

## 备选方案

继续把 `~/.dsh` 作为桌面 home 会让桌面运行时文件和其他 Harness 调用混在一起，也无法提供 App 自己管理插件的目录。迁移时删除旧 home 可能造成不可逆的数据丢失，因此实现为复制并保留旧目录。

## 后果

替换应用二进制后不需要用户手工搬运插件或技能数据。旧 home 作为恢复副本保留；之后通过桌面 UI 的写入不会回写旧目录。App 管理的内置 Bundle 不走外部插件卸载流程，外部依赖仍遵循现有审查和审计路径。
