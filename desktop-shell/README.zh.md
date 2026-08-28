# DeepSeek Harness macOS 桌面版

[English](README.md) | 中文

DeepSeek Harness Desktop 在 WKWebView 中嵌入官方 `dsh web` 应用，同时让 Harness 运行时、profile、Cordis 组合、设置与会话数据继续由原有组件管理。Swift 桌面壳增加原生进程生命周期、单实例保护、随机 loopback 端口之间的会话选择延续、源码更新与回退、标准“编辑”快捷键、外部链接路由，以及面向侧载 Profile Bundle 的审查安装器。

<p align="center"><img src="Resources/AppIcon.svg" width="112" alt="DeepSeek Harness Desktop 图标"></p>

这是本地 developer preview 构建。应用使用 ad-hoc 签名，不通过 Mac App Store 分发；上游 Web 应用变更后可能需要重新构建。

## 桌面行为

- **运行时生命周期。** 应用会为 Application Support 目录持有 advisory lock，使用 `--profile web --no-open --port 0` 启动仓库构建出的 CLI，并在 WKWebView 中打开 CLI 公布的 loopback URL。第二个应用副本只会激活既有进程，不会针对同一份数据启动另一套运行时。
- **一次性 Web 认证。** CLI 就绪行包含一次性 token。首次请求由 WKWebView 发起，以便把 token 换成当前 origin 的 cookie；后续重新载入使用移除 query 与 fragment 的同一 URL，不会重复消费 token。
- **会话延续。** document-start bridge 从原生偏好恢复不透明的当前会话选择记录，并同步后续选择变化。会话日志、草稿、设置与插件状态仍由 Harness 管理。
- **原生呈现。** 标准“编辑”菜单沿 AppKit responder chain 分发，外部链接在默认浏览器打开，透明标题栏则在侧边栏控件之外保留拖拽区域。
- **插件审查。** 仅桌面版可见的“插件库”会发现公开项目、固定网络来源、检查 Bundle 结构、把通过审查的变更委托给 `dsh plugin --profile web`，并写入 JSONL 审计日志。普通浏览器虽然挂载相同 client package，但没有原生 bridge，因此不会注册“插件库”界面。
- **启动恢复。** 如果一个侧载 Bundle 阻止运行时就绪，桌面壳可以用只省略该树外依赖的临时 profile 重试一次；它不会修改 Web profile 或卸载 package。

Web profile 可以同时接受当前插件和受支持的上一代外部插件。兼容 client 入口把旧 snapshot-store 与 settings 导入转发给当前 owner；瞬时文件 recognizer 可以把支持的通用文件转换为已记录文本，但不会把它们变成持久附件；LLM service 同时接受当前精确路由 metadata enricher，以及上一代 discovery、模态与容量注册。profile 会同时挂载本地 `Deepseek-Files`、Office recognition、Lark 与 model-catalog Bundle，以及当前 Web Search 和 Skin Center Bundle。

## 源码更新与回退

更新器会获取配置的 `origin` 分支，并且只接受活动源码到远端的 fast-forward。本地 checkout 已包含远端 commit 时保持不变。如果本地桌面 commit 与上游已经分叉，自动更新会停止并给出诊断，不会替换本地行为；应先在源码仓库中集成上游分支，重新构建，再启动新源码。

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

构建脚本会重新创建 `desktop-shell/dist/DeepSeek Harness.app`、生成 `AppIcon.icns`、在所有资源写入后应用 ad-hoc 签名，并把当前 checkout 记录为初始源码根目录。生成的应用使用开发 bundle identifier `ai.deepseek.harness.desktop.local`。

运行 `desktop-shell/scripts/package-dmg.sh` 可以创建可分享的磁盘映像。分发构建会移除开发者源码路径、嵌入仅由已跟踪文件组成的源码快照，并使用 `ai.deepseek.harness.desktop` identifier。产物仍是 ad-hoc 签名，且未经 notarization。

如果既有 `node` 与同目录 `npx` 不满足版本要求，启动流程会下载官方 Node.js 24.16.0 ARM64 归档，校验固定 SHA-256 摘要，再把它安装到 Application Support 下；该过程不需要管理员权限，也不会修改系统 Node.js 安装。

## 数据与日志

会话、设置、凭据、profile、插件依赖、受管理源码版本和桌面日志位于：

```text
~/Library/Application Support/DeepSeek Harness Desktop/
```

Harness 数据位于 `data` 子目录，与源码 worktree 和应用 bundle 分离。桌面运行时输出及原生错误追加写入 `logs/desktop.log`；插件审查与变更记录追加写入 `logs/plugin-audit.jsonl`。

## 安全限制

Web UI 只监听 `127.0.0.1`，桌面壳只接受来自主 frame loopback 页面上的特权导航。桌面可执行文件没有启用 macOS App Sandbox，因为它必须启动 Node.js、Git、package manager 与 agent 子进程，并访问用户选择的 workspace。Harness tool 沙箱仍由 Web profile 的组合决定；它不会隔离插件进程或桌面可执行文件本身。
