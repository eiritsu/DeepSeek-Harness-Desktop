# DeepSeek Harness macOS 桌面版

[English](README.md) | 中文

DeepSeek Harness Desktop 在 WKWebView 中嵌入官方 `dsh web` 应用。用户数据由应用内置 SQLite 数据库负责；可执行的 profile 与 Skill 文件仍位于受管理的 Application Support 目录。Swift 桌面壳增加原生进程生命周期、单实例保护、随机 loopback 端口之间的会话选择延续、GitHub 源码更新与回退、标准“编辑”快捷键、外部链接路由，以及面向侧载 Profile Bundle 的审查安装器。

<p align="center"><img src="Resources/AppIcon.svg" width="112" alt="DeepSeek Harness Desktop 图标"></p>

这是本地 developer preview 构建。应用使用 ad-hoc 签名，不通过 Mac App Store 分发；上游 Web 应用变更后可能需要重新构建。

## 0.1.11 版本说明

本版本与 0.1.10 的差异集中在四项桌面数据保证：导出前会 checkpoint SQLite WAL，导入会把数据库和文件制品作为一个操作暂存并支持回滚，维护操作会在替换文件前关闭 catalog，备份操作取消后不再显示成功。本版本还增加了原生备份往返测试，并将发行版构建改为从桌面源码仓库的 `main` 分支获取更新。

## 0.1.12 版本说明

本版本将技能库“已安装”页与插件库对齐：已安装技能支持搜索、详细／简洁卡片视图，并可直接从桌面 Application Support 管理目录卸载。

## 桌面行为

- **运行时生命周期。** 应用会为 Application Support 目录持有 advisory lock，使用 `--profile web --no-open --port 0` 启动仓库构建出的 CLI，并在 WKWebView 中打开 CLI 公布的 loopback URL。第二个应用副本只会激活既有进程，不会针对同一份数据启动另一套运行时。
- **一次性 Web 认证。** CLI 就绪行包含一次性 token。首次请求由 WKWebView 发起，以便把 token 换成当前 origin 的 cookie；后续重新载入使用移除 query 与 fragment 的同一 URL，不会重复消费 token。
- **会话延续。** document-start bridge 从原生偏好恢复不透明的当前会话选择记录，并同步后续选择变化。会话日志、草稿、设置与插件状态仍由 Harness 管理。
- **原生呈现。** 标准“编辑”菜单沿 AppKit responder chain 分发，外部链接在默认浏览器打开，透明标题栏则在侧边栏控件之外保留拖拽区域。
- **插件管理。** 仅桌面版可见的“插件库”会显示 App 内置 Bundle、Skill 与外部依赖；外部来源先固定网络来源并检查 Bundle 结构，再把通过审查的变更委托给 `dsh plugin --profile web`，并写入 JSONL 审计日志。插件依赖、Skill 数据和 profile 都位于 Application Support 下。普通浏览器虽然挂载相同 client package，但没有原生 bridge，因此不会注册“插件库”界面。
- **启动恢复。** 如果一个侧载 Bundle 阻止运行时就绪，桌面壳可以用只省略该树外依赖的临时 profile 重试一次；它不会修改 Web profile 或卸载 package。

Web profile 可以同时接受当前插件和受支持的上一代外部插件。兼容 client 入口把旧 snapshot-store 与 settings 导入转发给当前 owner；瞬时文件 recognizer 可以把支持的通用文件转换为已记录文本，但不会把它们变成持久附件；LLM service 同时接受当前精确路由 metadata enricher，以及上一代 discovery、模态与容量注册。profile 会同时挂载本地 `Deepseek-Files`、Office recognition、Lark 与 model-catalog Bundle，以及当前 Web Search 和 Skin Center Bundle。

## 源码更新与回退

更新器会在 Application Support 下专用的 `source-repository` 目录 clone/fetch 配置的 GitHub 仓库与分支，绝不会对解包后的应用快照或开发者 checkout 执行 `git fetch`。只接受 fast-forward；本地仓库与上游分叉时停止并给出诊断，不替换本地行为。

安全的 fast-forward 会在分离的 Git worktree 中准备。桌面壳安装未改动的 lockfile、构建仓库、使用独立 probe 数据启动暂存 CLI、交换一次性认证 token，并要求 HTTP 200 后才切换活动源码指针。上一个指针仍可用于回退。回退只改变源码选择，不能撤销持久化数据迁移。

## 插件来源审查

审查接受精确 npm 版本、固定到 commit 的 HTTPS GitHub 仓库或本地目录。可直接安装的来源必须具有有效根 package manifest，并由 `dsh.bundle.patch` 指向实际存在的包内 YAML 入口。网络与本地来源会在安装前再次经过相同结构检查；审查 token 只能使用一次，并在 15 分钟后失效。

GitHub 的 `dsh-plugin` topic 与 deepseek1024.com 是两个独立且未经信任的发现目录。进入目录不代表背书或安装资格。原生审查器会在安装前解析不可变来源，并拒绝格式无效、可变或结构不兼容的候选项。

安装会强制保存精确版本并禁用依赖 lifecycle script。这些检查可以降低安装阶段风险，但不会沙箱化已启用插件；第三方代码可以使用其 Harness 组合授予的文件、网络、进程与凭据访问能力。

## 构建与运行

前置条件是 macOS 13 或更新版本、Swift 6、Node.js `^22.19.0 || >=24.0.0`、Git、librsvg 提供的 `rsvg-convert`，以及首次安装依赖所需的网络连接。在仓库根目录执行：

```sh
npx --yes pnpm@11.7.0 install --frozen-lockfile
npx --yes pnpm@11.7.0 run build
desktop-shell/scripts/build-app.sh
open "desktop-shell/dist/DeepSeek Harness.app"
```

构建脚本会重新创建 `desktop-shell/dist/DeepSeek Harness.app`、生成 `AppIcon.icns`、在所有资源写入后应用 ad-hoc 签名，并在开发构建中把当前 checkout 记录为初始源码根目录。发行版会移除本地源码指针；安装后的应用从内置快照启动，并从 GitHub 更新。开发应用使用 bundle identifier `ai.deepseek.harness.desktop.local`。

运行 `desktop-shell/scripts/package-dmg.sh` 可以创建可分享的磁盘映像。分发构建会移除开发者源码路径、Git 元数据、测试、快照、source map 和仅开发使用的文档；它会嵌入已验证的 Harness 运行时/Web 产物，以及旁置 `DeepSeek Plugin` checkout 中六个自研插件包（可用 `DSH_PLUGIN_DIR` 覆盖路径）。Web profile 首次启动时默认启用插件库、技能库、Deepseek-Files Office 识别、Lark 和 model-catalog Bundle。产物使用 `ai.deepseek.harness.desktop` identifier，仍是 ad-hoc 签名且未经 notarization。

如果既有 `node` 与同目录 `npx` 不满足版本要求，启动流程会下载官方 Node.js 24.16.0 ARM64 归档，校验固定 SHA-256 摘要，再把它安装到 Application Support 下；该过程不需要管理员权限，也不会修改系统 Node.js 安装。

## 数据与日志

会话、设置、凭据、profile、插件依赖、Skill 数据、受管理源码版本和桌面日志位于：

```text
~/Library/Application Support/DeepSeek Harness Desktop/
```

Harness 数据位于 `data` 子目录，与源码 worktree 和应用 bundle 分离。桌面运行时输出及原生错误追加写入 `logs/desktop.log`；插件审查与变更记录追加写入 `logs/plugin-audit.jsonl`。

桌面启动时会先在 `data/dsh-desktop.sqlite` 建立统一的数据清单与迁移表，再启动 Harness；SQLite 使用单调递增的 `user_version`，高版本数据库会拒绝被旧 App 覆盖。会话、设置、凭据、storage unit、profile／Skill 元数据、插件审计记录和 source-release 记录都持久化到 SQLite。由于 Loader 和 Skill provider 需要直接执行，profile manifest 与 Skill 源文件仍是文件制品；旧版审计 JSONL 作为兼容导出保留，SQLite 是可查询的 owner。桌面壳还会用受保护的 `runtime.pid` 回收强制退出后遗留的同一 Harness 运行时，避免下一次更新因孤儿进程而报状态码 1。

首次启动会把旧版 `~/.dsh` 中缺失的数据合并到该目录；旧目录保留不删除。之后通过桌面插件库安装或移除的外部插件继续写入 `data/profiles/web`，不会回写 `~/.dsh`。

## 安全限制

Web UI 只监听 `127.0.0.1`，桌面壳只接受来自主 frame loopback 页面上的特权导航。桌面可执行文件没有启用 macOS App Sandbox，因为它必须启动 Node.js、Git、package manager 与 agent 子进程，并访问用户选择的 workspace。Harness tool 沙箱仍由 Web profile 的组合决定；它不会隔离插件进程或桌面可执行文件本身。
