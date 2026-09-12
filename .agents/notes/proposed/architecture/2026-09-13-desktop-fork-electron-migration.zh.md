# Agent Note: 在上游 Electron 应用中保留桌面分支行为

Status: proposed

[English](2026-09-13-desktop-fork-electron-migration.md) | 中文

## Problem

桌面分支从 `dd6322d604` 起通过 78 个提交与上游分叉，增加了 macOS 与 Windows 原生壳、发行准备、插件与 Skill 市场、Lark、外部搜索提供方、Office 与 OCR 提取、模型元数据兼容、SQLite 持久化、会话操作以及原生文件交互。此后，上游已经替换 Web Client、Session 持久化、LLM 元数据、附件与 Desktop 架构。直接重放旧补丁会恢复已经移除的 API、重复上游的新行为，并让保留的功能无法编译。

合并提交 `eaa77a8687` 保留了双方完整父提交历史，并让当前分支相对 `origin/master` 落后数归零；但仅仅能从历史访问源码，并不等于每项分支功能已经能在新运行时使用。迁移需要一份明确清单，区分上游已经具备的行为与仍需当前所有者的行为。

## Proposal

把 `apps/desktop` 与 `apps/desktop-host` 作为唯一生产 Desktop 壳。合并后的 Swift 和早期 Windows Electron 源码在第一父分支桌面历史中保持可访问，直到每项行为映射到上游 Electron 实现或在其中重新实现。不要发布或维护两个生产壳。

分支改动按下表处理：

| 分支工作 | 上游状态 | 迁移动作 |
|---|---|---|
| macOS Swift 壳与早期 Windows Electron 壳 | 已由面向 macOS 和 Windows 的签名 Electron 应用替代 | 完成行为映射后退役旧壳源码；Linux 打包只能作为单独完成质量验证的目标加入 |
| 内置 Node、pnpm、源码来源证明、启动就绪、单实例、插件变更、恢复、更新、签名与 Cookie 隔离 | 已由无端口 Desktop Host、带版本运行时清单、受管 profile、插件管理器、恢复页、自动更新器与平台签名替代 | 保持上游所有权；不要恢复 loopback server 或首次启动从源码构建的设计 |
| 会话重命名、fork、归档、删除、Workspace 成员关系、Web 压缩、通用文件上传、图片处理、reasoning 元数据与模型选择 | 已存在于较新的上游能力和 Client 模型中 | 用聚焦测试确认用户可见行为一致后移除分支兼容层 |
| 原生文件与目录选择、拖放、会话导出和外部导航 | 大部分已由当前 Client upload、directory-picker、deliverables、export 与 open-in-app 能力提供 | 只通过窄 preload IPC 补充缺失的 Electron 专属交互 |
| Lark/飞书私聊 Agent 与管理 UI | 上游不存在 | 迁移到当前 Agent 生命周期、Session journal、Typert Remote、Slots 与 locale API |
| SkillHub 插件与 Skill 发现 | 上游不存在；Desktop 已负责包变更 | 把发现与审查加入当前 Desktop 插件管理器；Skill 安装使用独立且经过审查的文件系统操作 |
| Brave、Tavily、Exa、GitHub 与 Firecrawl 连接 | 与上游 Exa 提供方部分重合，但缺少凭据门控目录和设置界面 | 保留专用工具；注册一个内部应用保存优先级的聚合 `WebSearchProvider`，使 `WebRuntime` 仍只有明确的提供方 |
| Office、PDF、音视频回退与图片 OCR | 上游已持久化通用文件，但没有内容提取 | 引入包含 Service Definition、providers 和 prompt/read Consumers 的完整提取能力；所有模型可见提取文本都通过 Session 事件记录 |
| model-catalog 兼容包与通用 reasoning 回退 | 已由适配器所有的 `resolveModelInfo`、可配置 pi-ai 路由与内置 pi-ai 目录替代 | 将 pi-ai 配置未覆盖的目录条目迁移后删除兼容包 |
| 权威 SQLite Session 持久化 | 上游已明确改用 JSONL；当前 persistence handle 与 Session 格式也不同 | 不恢复 SQLite 实时后端；把可识别的桌面数据库一次性、按版本导入当前 JSONL，并保留源数据库作为恢复证据 |
| plugin-library 与 client-runtime 兼容包 | 已由 Electron 插件窗口和当前 Client module/Slot API 替代 | 只重建独有市场行为；不保留运行时 re-export shim |

每个保留功能都必须采用当前 package 划分。需要 Host 与 Client 的 package 使用独立编译面。产品 UI 使用 typed locale dictionary 与 Slots。所有模型可见提取内容必须记录。运行时 provider 选择保持显式并可随生命周期释放。旧数据导入只识别一种精确 schema，通过当前公开服务写入，保持幂等且从不删除来源。

迁移分成可审查的阶段落地：建立上游 Electron 基线；从 active build 移除已被替代的兼容代码；迁移 external tools；迁移 Lark；增加提取能力；增加 SkillHub；增加旧数据导入；最后验证 macOS 与 Windows 安装包。只有当合并父提交与本文映射让旧文件的历史和去向都可检查后，旧文件才能离开 active tree。

## Alternatives considered

**继续使用 Swift 壳并单独维护 Windows Electron 壳。** 这能暂时保留当前 macOS 行为，但会重复生命周期、打包、更新、安全和插件管理工作，也无法形成统一的跨平台产品架构。

**把 78 个提交全部重放到当前上游。** 这些提交面向已不存在的 API，并包含已被上游设计替代的兼容行为。文本重放只有在恢复废弃接口后才能编译，还会为 Session、attachment、LLM 与 Client state 引入竞争所有者。

**丢弃分支并在不保留历史的情况下从上游重做。** 这样能得到干净工作树，但会失去用户数据迁移和独有功能的可审查来源。重建当前实现期间，双父合并能更可靠地保留历史。

**继续把 SQLite 作为 Desktop Session 的权威后端。** 上游现在把 JSONL 作为规范 Session log，并把 SQLite 用作派生查询存储。第二种权威格式会再次分裂生命周期和恢复语义；窄范围 importer 可以保留用户数据，而不会恢复这种分裂。

## Acceptance criteria

- 集成分支包含双方原始历史，而且相对上游不落后。
- 默认构建和聚焦 Desktop 测试通过，且不会加载旧壳或已移除的兼容 API。
- 23 组分支 Agent Note 中的每一组都已映射到当前上游所有者、被归并替代，或保留并指定迁移所有者。
- Lark、external tools、Office/OCR 提取、SkillHub 与旧 Session 导入在声明“已保留”之前，都具有当前 composition test 和用户可见 snapshot。
- macOS 与 Windows 安装包使用同一份 Electron 源码和内置运行时；未来 Linux 目标在完成打包与原生依赖矩阵验证前不得对外宣称支持。
- 整个迁移过程都能恢复旧桌面数据，任何步骤都不会删除 Swift Application Support 数据或 SQLite 源数据库。

## Risks

最大风险是把源码保留误认为行为保留。在上述聚焦测试通过前，即使独有分支提交仍可访问，这些功能仍属于迁移中工作。Lark 和提取能力涉及生命周期与模型可见数据，浅层适配可能丢失历史或泄漏未记录上下文。Desktop 数据存在于多个历史根目录和格式中；猜测 schema 的 importer 可能损坏当前 Session。Electron 提高了平台复用程度，但不会自动提供 Linux 支持，因为原生模块、打包、签名、系统集成和发行验证仍然依赖具体平台。
