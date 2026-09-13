# Agent Note：保留 Desktop 兼容扩展

状态：已实现

[English](2026-09-13-desktop-compatibility-extensions.md) | 中文

## 问题

Desktop 迁移到上游 Electron 基线时删除了动态模型 catalog 与原生插件库 package。Swift 配置导入器还会把脱敏后的旧数据库当作实时 Session 数据库，并整体替换 profile 与 Skill 目录。结果是当前 Session 状态丢失、旧 `llm-dsh-ai` provider 设置无法激活，而且当前内置或第三方 profile 条目会被删除。

## 决策

两个 Desktop profile 都挂载 `@deepseek-ai/dsh-model-catalog`，并禁用隐式 `llm-deepseek` 路由。catalog 持久化 last-good `models.dev` 快照，为模型发现提供权威 metadata，并为运行时提供输入、容量与推理事实。只有模型条目没有显式声明输入模态时，`llm-pi-ai` 才会查询 catalog；显式路由配置继续拥有最高优先级。prepared call 与单独模型检查使用同一条 effect-scoped metadata 链。

Swift Lite 还会挂载 `@deepseek-ai/dsh-client-ui-plugin-library`，并把两个恢复的 package 纳入受管理源码集合。配置导入器保留实时 Session SQLite 数据库、合并 profile 与 Skill、把旧 `llm-dsh-ai` 设置映射为 `llm-pi-ai`，并且只把旧 Web profile 的第三方依赖与 Bundle 带入 `desktop-lite`。导出在脱敏前使用 SQLite backup 操作，并包含不含密钥的 settings 文件。导入后的 settings 权限仅允许 owner 读写。

## 考虑过的替代方案

**只使用 pi-ai 内置 catalog。** 这种方案可离线工作且体积更小，但模型声明会冻结在应用依赖版本，再次造成 Desktop fork 已经解决过的 metadata 回退。

**用旧导出整体替换当前数据。** 这会复现旧导入器的行为，但配置归档按设计包含脱敏数据库，不能成为 Session 恢复的权威来源。合并配置并保持 Session 恢复独立，可以同时保留两类数据。

## 结果

Desktop 启动时不再出现默认 provider 卡片，但已配置路由可以获得当前上游模型声明，而且不会重写用户设置。catalog 刷新失败时保留 last-good 数据，未覆盖字段继续回退 pi-ai。旧配置恢复不再充当 Session 恢复；Session 备份与恢复继续作为权威数据库上的独立操作。导入配置时会保留插件文件与当前 profile 条目。

## 验证

针对性测试覆盖 catalog 刷新、模型发现与 prepared-call 补充、显式模态优先级、package 卸载、配置 namespace 迁移、profile 与 Skill 合并、Session 数据库保留以及 settings 的 `0600` 权限。Desktop 打包审计要求嵌入运行时包含两个恢复的 package。
