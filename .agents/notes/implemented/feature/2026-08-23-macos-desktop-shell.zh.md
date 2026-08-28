# Agent Note: Web profile 的 macOS 桌面壳

Status: implemented

[English](2026-08-23-macos-desktop-shell.md) | 中文

## 问题

loopback `dsh web` 应用需要浏览器窗口和进程 owner。桌面构建需要原生生命周期、菜单、导航、更新和插件管理行为，同时不能建立第二套 client，也不能把会话、设置、profile、审批与持久化从既有组合移走。

官方 Web Host 还会在第一次根路径请求时交换进程本地 launch token。如果原生就绪探测在 WKWebView 之前请求该 URL，就会消费一次性 token，却无法把签名 cookie 交给浏览器。源码更新则有另一项风险：用 `origin/master` 替换已经分叉的本地桌面分支，会静默丢弃应用本来需要保留的本地功能。

## 决策

`desktop-shell/` 是 macOS 13 Swift 应用。它为 Application Support 根目录持有单实例锁，使用 `--profile web --no-open --port 0` 启动构建后的 CLI，并把公布的 loopback URL 嵌入 WKWebView。正常启动以 CLI 就绪行为 commit point。桌面壳保留完整 token URL，并让 WKWebView 发起第一次请求；浏览器按照[浏览器 launch-token 认证决策](../architecture/2026-08-24-browser-token-authentication.zh.md)交换 token 后，后续 reload 使用相同 authority，但移除 query 与 fragment。更新探测可以请求隔离候选运行时的 URL，因为完成 HTTP 检查后会丢弃该运行时。

document-start bridge 只把不透明的当前会话选择记录保存到原生偏好，避免随机端口重置导航。原生“编辑”菜单沿 AppKit responder chain 分发，外部链接离开嵌入页面，透明标题栏则在侧边栏之外保留拖拽区域。应用本身不运行服务器，并保持 Web profile 的 tool 沙箱、设置、审批与持久状态不变。

桌面壳会向 loopback 主 frame 注入返回 Promise 的插件管理 bridge。`dsh-client-ui-plugin-library` 把这个 bridge 作为能力信号：只在 bridge 存在时贡献一个 `sidebar.footer.action` 配置项与一个 `shell.overlay` 配置项。原生侧会固定网络来源、校验根 manifest 和 `dsh.bundle.patch` 目标、签发有效期 15 分钟的一次性审查 token、把安装与移除委托给 `dsh plugin --profile web`，并追加写入 JSONL 审计记录。精确保存和禁用依赖 lifecycle script 是安装预防措施，不是运行时隔离。

如果一个侧载 Bundle 阻止启动，并且失败 package 是 Web profile 的树外依赖，桌面壳可以用只省略该 Bundle 的临时 profile 重试一次。已安装 package 与权威 Web profile 保持不变。内置或无法归因的失败仍会快速失败。

源码更新只接受活动源码到配置 `origin` 分支的 fast-forward。已包含远端 commit 的源码就是当前版本。分叉会快速失败，并要求在仓库层完成集成，因此自动更新无法替换本地桌面 commit。允许的更新会在分离 worktree 中构建，并使用独立 probe 数据启动；只有成功交换 launch token 且获得 HTTP 200 后，才会切换活动源码指针。上一个指针仍可用于回退。

Web 组合同时支持当前插件和上一代外部插件。client-runtime 兼容包把旧 snapshot-store 与 settings 导入转发给当前 owner，而不创建重复的客户端 service。附件服务仍只把 raster image 作为持久二进制类型，同时允许受信任 recognizer 把瞬时通用文件字节转换为已记录文本。LLM 把精确路由 metadata enrichment 作为当前 API，同时接受上一代 catalog 的 effect-scoped discovery、输入模态与容量注册。pi-ai 适配器消费两条路径，并把请求模态过滤到当前提供方无关的 text/image 词汇。

## 考虑过的替代方案

**在加载 WKWebView 前探测正常运行时 URL。** 拒绝，因为探测会消费进程 token，而 cookie 会留在 URLSession，无法进入 WKWebView。

**直接 fast-forward 到每个已获取的上游 commit。** 拒绝，因为分叉的本地分支会丢失桌面行为。可安全自动执行的情况只有经过 ancestry 证明的 fast-forward；其他 topology 都属于仓库集成任务。

**要求所有已安装插件先完成迁移，桌面应用才能启动。** 拒绝，因为受支持的上一版本 bundle 使用的公开导入与注册表可以转发到唯一当前 owner。兼容接口是精确且附加式的：它不恢复 ApiProxy、不持久化通用文件字节、不复制 slot registry，也不让旧 audio/video 模态进入当前模型请求。

**通过普通浏览器 Remote 暴露插件变更。** 拒绝，因为执行 package manager 是仅桌面版拥有的特权行为。document-start 主 frame 原生 bridge 可以保持浏览器部署不变。

## 后果

桌面应用保留官方 Web 应用及其当前安全模型，同时增加原生生命周期与经过审查的插件管理。首次启动和 reload 能在随机 loopback 端口正确认证。自动源码更新会拒绝分叉以保留本地改动，代价是上游与桌面分支都前进时必须手动集成。

侧载插件仍是可信本机代码。结构审查可以发现可变或格式无效的来源，并禁止依赖 lifecycle script，但不会限制运行时文件、网络、进程或凭据访问。应用仍采用 ad-hoc 签名，并且不会启用 macOS App Sandbox，因为它必须启动 CLI、Git、package manager 与 agent 子进程。

当前与上一版本插件可以在同一个 Web profile 中运行。持久图片与 adapter 所有的模型解析仍是权威实现；兼容注册只提供瞬时识别文本，或填充精确路由缺失的 metadata。转发范围刻意限于受支持外部插件实际使用的导入与注册行为，其他已经移除的内部实现仍不受支持。
