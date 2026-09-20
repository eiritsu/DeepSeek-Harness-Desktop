---
description: "构建、运行和打包 DeepSeek Harness Lite：复用上游 Node host 的原生 AppKit + WKWebView macOS 壳。"
kind: "app-guide"
---

# DeepSeek Harness Lite macOS 版

[English](README.md) | 中文

DeepSeek Harness Lite 是 [`../apps/desktop`](../apps/desktop) Electron 应用的低内存原生替代版本。它在 `WKWebView` 中嵌入同一套当前 Web client，并用内置 `desktop-lite` profile 启动官方 `dsh` Node host。产品行为继续由共享 TypeScript 包负责；Swift 只负责 macOS 生命周期、WebView 集成、源码更新、下载与原生文件对话框。

透明标题栏会隐藏原生窗口标题，只把静态品牌区域留给窗口拖动，Web 工具栏与侧栏标签控件仍由 `WKWebView` 接收点击。

## 兼容性

Swift Package 和应用 plist 面向 Apple silicon 上的 macOS 11.0 至 macOS 26。macOS 11.3 及以上使用原生 `WKDownload` 下载路径；壳的其他功能仍可在 11.0–11.2 使用。开发需要 Swift 6、Node.js `^22.19.0 || >=24.0.0`、Git，以及 librsvg 提供的 `rsvg-convert`。

Electron runtime 已不再支持 macOS 11 和 12，因此 Electron 应用面向 macOS 13 至 macOS 26。两个产品都是 arm64 构建，并使用不同名称和 bundle identifier：

| 产品 | Bundle identifier | 产物 |
|---|---|---|
| Lite 开发版 | `ai.deepseek.harness.desktop.lite.local` | `desktop-shell/dist/DeepSeek Harness Lite.app` |
| Lite 隔离测试版 | `ai.deepseek.harness.desktop.lite.isolated` | `desktop-shell/dist-isolated/DeepSeek Harness Lite Isolated.app` |
| Lite 发行版 | `ai.deepseek.harness.desktop.lite` | `desktop-shell/dist/DeepSeek-Harness-Lite-macOS.dmg` |
| Electron | Electron 包配置的 identifier | 由 `apps/desktop` 负责输出 |

## 共享数据与保留功能

生产环境的 Lite 壳使用 `~/.dsh` 作为 `DSH_HOME`，与 Electron 和 CLI 一致。隔离测试版使用 `~/Library/Application Support/DeepSeek Harness Lite Isolated/data`，不会读取或迁移 `~/.dsh`。`desktop-lite` 与 Electron 组合都把 `$DSH_HOME/desktop/dsh-desktop.sqlite` 用作权威 Session 持久化。因此两个壳可以保留同一份 Session 历史、Session ID、跨 Session 引用、附件 metadata 与 SQLite 迁移行为。两个 profile 都会挂载 DeepSeek Files 识别、外部搜索 provider 设置、SkillHub、原生插件库、Lark 与 `dsh-model-catalog`。模型 catalog 会从 `models.dev` 刷新完整的上游声明，并补充模型发现和实际调用，但不会隐式创建 provider 路由。

Swift 壳把自身的源码/更新审计 catalog 保存在 `~/Library/Application Support/DeepSeek Harness Lite`；这个辅助数据库不是 Session 权威来源。较新的应用 build 会先启用内置源码快照，再读取较旧的托管 release；build identity 同时阻止旧应用副本替换由较新 build 安装的源码。runtime 维护和应用退出会在停止 Host 前隐藏 WebView，因此输入框无法向即将退出的进程提交消息。强制同步 profile 时，当前 manifest 中已不存在的依赖会被标记为已移除，因此其插件清单不会继续报告陈旧安装。首次启动可以从旧版 `~/Library/Application Support/DeepSeek Harness Desktop/data` 迁移数据，并保留旧目录。

`dsh web:` 启动行是壳的就绪信号：Web profile 只会在插件加载完成结算且本地服务器可用后输出该行。Lite 收到该信号后直接导航一次，不再探测私有插件路由。旧数据迁移复制 `.credentials.yaml` 时，Lite 会把权限收紧为 `0600`；格式错误的凭据文件仍会导致启动失败，但失败界面会指出文件和恢复操作，且不会显示凭据值。

配置导出会脱敏：凭据、Session 正文、附件字节、日志和机器身份不会导出。导入会合并 profile 与 Skill，在不替换权威 Session 数据库的情况下恢复设置，把旧 `llm-dsh-ai` namespace 迁移为 `llm-pi-ai`，并将旧 Web profile 的第三方插件带入 `desktop-lite`。重置会先停止 Node runtime，再清理其拥有的数据。在同时分发两个壳之前，打包还必须保证同一时间只有一个桌面写入者。

Lite payload 会携带 Computer Use service、native Cua provider 及其 runtime 依赖，随应用发布的 `desktop-lite` profile 默认挂载它们。payload 不会授予 macOS 辅助功能或屏幕录制权限，所需的 TCC 授权仍须由用户完成；在 Windows 上 provider 需要交互桌面会话。Cua Driver 使用 standard permission 流程。

## 开发

在仓库根目录执行：

```sh
swift test --package-path desktop-shell
desktop-shell/scripts/build-app.sh
open "desktop-shell/dist/DeepSeek Harness Lite.app"
PATH="/opt/homebrew/bin:/opt/homebrew/sbin:$PATH" desktop-shell/scripts/build-app.sh --isolated
open "desktop-shell/dist-isolated/DeepSeek Harness Lite Isolated.app"
```

只在干净且已经发布的 release commit 上创建发行 DMG：

```sh
desktop-shell/scripts/package-dmg.sh
```

发行包会嵌入当前仓库源码和已构建 runtime 产物，移除开发者路径与仅供仓库使用的内容，生成 `AppIcon.icns` 并应用 ad-hoc 签名。Notarization 与 Developer ID 签名仍属于发行阶段工作。
