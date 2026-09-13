# Agent Note: 双 macOS 壳共享一个 Desktop Host 与权威 SQLite

Status: proposed

[English](2026-09-13-dual-macos-shells-and-authoritative-sqlite.md) | 中文

## Problem

桌面分支有两个无法由单一 shell 同等满足的合理产品要求。其 Swift shell 内存占用明显更低，并与 macOS 紧密集成；上游 Electron 应用则提供可维护的 Windows 与 Linux 演进路径。分支还包含仅保留提交并不能保留的用户可见能力：完整模型元数据、文件与文件夹附件入口、Office/OCR 与媒体路由、外部搜索 provider 优先级、权威 SQLite Session 存储、备份/导出/导入、Session 操作、跨 Session 读取、DeepSeek Files 策略、SkillHub、Lark 和命令行优化。

用 Electron 替代 Swift 会丢失轻量 macOS 产品。维护两个独立应用则会重复 Session、设置、插件、更新与数据管理行为，并让两者数据分叉。当前 Electron 44 系列支持 macOS 13 及以上版本，因此不能覆盖每个 Apple Silicon macOS 版本；Apple 的 Xcode 26 工具链可使用 macOS 11 deployment target 与 macOS 26 SDK 构建原生应用。

## Proposal

从同一仓库交付两个 macOS 应用产品：

- **DeepSeek Harness Lite** 使用 Swift 与系统 WebKit/SwiftUI 栈。其 Apple Silicon deployment target 为 macOS 11，发行验证覆盖 macOS 11 至 macOS 26。
- **DeepSeek Harness** 使用上游 Electron 应用。其 Apple Silicon 目标遵循 Electron 44 支持的 macOS 范围，即 macOS 13 至 macOS 26。Windows 仍是 Electron 目标；在原生依赖与安装包通过验证前，不对外宣称 Linux 支持。

Shell 包含生命周期与操作系统集成。Electron 使用 desktop patch 启动 `apps/desktop-host`，并通过私有 `dsh-app:` protocol 提供 renderer；Swift 则使用受支持的 `dsh --profile desktop-lite --no-open --port 0` 入口启动 loopback Web 应用，并嵌入 `WKWebView`。两个 profile 都扩展同一 Web Client 组合并挂载相同桌面功能包，但 transport 与 native picker 行不同。Electron 与 Swift 共享 `$DSH_HOME/desktop/runtime.lock` 进程生命周期所有权锁；第二个 shell 会报告现有所有者，而不是并发打开相同数据。

Desktop 使用 `dsh-desktop.sqlite` 作为权威 Session 存储。当前 handle-based `SessionPersistence` API 负责 append 顺序、实时事件批处理、flush 持久性、当前格式校验和 Session 重建。SQLite 以事务方式存储 header、继承 cut、事件、计数与单调 revision。JSONL 仍是非桌面 profile 的默认值。现有桌面 SQLite 行与受支持 JSONL generation 通过显式版本化导入路径迁移；迁移绝不猜测布局，也不删除来源。

每个 shell 都会在数据维护前停止 Host。两类用户操作保持独立：现有 Swift 配置 archive 带版本化 manifest，并排除凭据、Session 正文、附件、机器身份与日志；Session 数据库导出则不脱敏地复制已关闭的权威 SQLite 文件，在导出和导入前验证 schema，并在替换失败时回滚。Electron 通过窄且校验 sender 的 IPC 实现同一 Session 数据库操作。完整 Session 日志导出仍是独立用户操作，只包含选定 Session。共享 Host 配置归档服务暂缓；文档与 UI 不得暗示两类备份具有相同的保密属性。

分支功能清单由以下当前所有者负责：

| 能力 | 当前所有者与迁移规则 |
|---|---|
| 完整模型元数据与 reasoning 能力 | `dsh-model-catalog` 刷新上游 `models.dev` 声明并补充 `llm-pi-ai` route，但不创建 provider；对同 ID 声明保守合并，避免不透明网关宣告任一上游声明并不支持的容量或模态 |
| 文件/文件夹 GUI、拖放与全部 Session 文件 | 当前 attachment 与 file-upload packages 传递 `mediaType`；浏览器文件夹和 Swift 原生文件/目录经独立且有界的操作进入 |
| DeepSeek Files 路由 | `file-recognizer-office` 注册到当前 Attachment recognizer seam；prompt admission 保留模型原生 modality，并记录 fallback 文本 |
| Session 重命名、fork、归档、删除、Workspace 成员关系、复制 id 与日志下载 | 上游已有重命名、fork、归档与日志下载；本迁移增加持久化递归删除、加入 Workspace 与复制 id |
| 跨 Session 读取 | 已由当前 `session-reference`、`session-query` 与统一 reference picker 所有 |
| Brave、Tavily、Exa、GitHub 与 Firecrawl | 恢复为一个 Web provider；已保存的启用状态与 priority 在请求时覆盖基础 provider |
| 备份/导出/导入/重置 | Shell 停止各自 Host，并区分脱敏配置与未脱敏 Session 操作；Session SQLite 验证和回滚有 parity tests |
| SkillHub | 恢复并适配当前架构的 Client 包服务两个 shell；Swift 与 Electron 通过窄 bridge 分别负责有界目录请求、压缩包校验、安装、枚举和按精确名称移除 |
| Lark | 移植后的 Host 能力负责凭据、官方 CLI 执行、审批分类、持久化私聊 Session、附件与生命周期；移植后的 Client 包负责类型化 Remote 设置 UI |
| `dsh` 命令优化 | 当前上游已有 shipped profile template、排他模板创建与精简 option forwarding；本变更只新增 `desktop-lite` template |
| Subagent 0.1.5 回归 | 当前 native-backed catalog、settlement、continuation 与 teardown tests 全部通过；已报告修复都已包含在上游 |

每项保留能力都使用当前 package role 与 Cordis effect。Client 文案保存在 typed locale dictionary 中。每项模型可见文件提取、跨 Session 输入、provider 结果与 Lark 消息都能从 Session 日志重建。SkillHub 安装会拒绝非法标识符、超大响应、符号链接、条目过多的压缩包、缺少 manifest、重复目标和名称有歧义的移除请求。

## 当前审计证据

第一次针对当前代码树的 `packages/subagent` 审计在构建仓库的 Darwin arm64 `system.node` 后通过全部 826 项测试。最初的失败全部来自缺失 native addon 的环境准备，不是可复现的子代理缺陷。已合入的上游历史已经包含所报告 0.1.5 时期的修复：无效 catalog 与 snapshot 顺序（`661135fe29`）、catalog 失败后的 run rejection（`ba731d1c9e`）、declaration augmentation（`0274a6dd75`）、Host catalog event export（`924282cbcd`）、catalog event 顺序（`80e34ce709`）、parent-owned catalog（`2db4bdd31d`）、preset teardown（`3a98d05a3d`）和 `agent-started` 清理（`e7bde97aa0`）。在 native 前置条件存在时没有行为失败之前，不应再改动子代理代码。

SQLite migration 测试会构造原桌面 schema 与 released v0 Session，并验证启动过程先通过已安装的 v0-to-v3 catalog 重写数据，`stat`、`open` 或 append 才能观察它。相邻迁移会接纳已发布的 Lark 消息来源，并把其历史 file block `recognizedText` 表示转换为当前 DeepSeek Files 文本 block，同时保留附件和传输标识。真实 `desktop-lite` 配置 dump 将 provider 替换固定为两项 Loader 操作：禁用基础 JSONL 行，并以独立 id 插入 SQLite provider。这能避免 include patcher 的 package-name 校验跳过替换。JSONL 与 SQLite persistence suites（包含持久化删除）目前通过 210 项测试。Swift 的 47 项测试包含权威 Session 数据库导出、导入、重置与 schema 校验。

移植后的 Lark Host 与 Client suites 针对当前 settings、SessionQuery、attachment、Typert 和 lifecycle API 通过 40 项测试。Electron SkillHub bridge 测试覆盖不可信请求解析、catalog 投影、已安装 manifest 枚举和精确移除；共享 Client 测试覆盖 controller 状态与结果规范化。

## Alternatives considered

**只使用 Electron。** 这能最大化 shell 复用，但会丢失轻量原生产品；而且当前 Electron 系列不支持 macOS 11 与 12。

**相互独立的 Swift 与 Electron 应用。** 这能保留两个界面，但会为 Session、设置、备份、插件和迁移产生两个权威实现。功能与数据漂移会成为永久发行风险。

**以 JSONL 作为桌面权威、SQLite 只用于查询。** 这符合通用上游 profile，但无法保留分支的事务桌面数据库、协调备份/导入行为与现有用户数据模型。非桌面 profile 继续使用 JSONL，可避免把桌面选择强加给核心产品。

## Acceptance criteria

- Swift 与 Electron 应用都启动同一个内置 Desktop Host，并渲染相同的当前 Client 组合。
- 两个 shell 之间同一时刻只有一个 Host 能拥有 Desktop home；崩溃后无需手动清理即可释放所有权。
- SQLite 通过共享 persistence 与 live-write contracts，导入可识别的旧桌面 schema 和受支持的已发布 Session 格式，并为 `stat`/`list` 提供单调 revision。
- 两个 shell 的 Session 数据库备份/导入/重置具有等价的关闭 Host、schema 校验与回滚行为；配置 archive 明确独立且经过脱敏。
- 完整分支功能清单都有当前代码所有者和聚焦 parity 测试，包含 SkillHub UI/原生安装与 Lark Host/Client 集成。
- Swift arm64 安装包运行于 macOS 11 至 26；Electron arm64 安装包运行于 macOS 13 至 26。签名、公证、更新、picker、下载与 deep-link smoke 在最旧和最新受支持版本上通过。
- 0.1.5 subagent 审计把每项报告记录为已复现、上游已修复或无法复现，并为每个保留修复提供聚焦测试。

## Risks

共享 TypeScript packages 消除了大部分重复产品逻辑，但两个 shell 仍会使打包、签名、更新、无障碍、数据维护与操作系统集成测试增加一倍。即使加载同一 Client bundle，原生 WebKit shell 也可能呈现与 Chromium 不同的渲染结果。支持 macOS 11 会独立限制 Swift 与 WebKit API，并不取决于 Xcode 26 能否完成编译。WAL 页面位于独立文件中，因此两条 shell 路径都会先停止 Host 再复制。在打包签名、升级、原生选择器、SkillHub 下载、Lark 连接与最旧/最新 macOS smoke 通过前，发布 parity 声明仍是临时结论。

## Sources

- [Electron 44 发行支持策略](https://www.electronjs.org/blog/electron-44-0)
- [Apple Xcode 系统要求](https://developer.apple.com/xcode/system-requirements)
