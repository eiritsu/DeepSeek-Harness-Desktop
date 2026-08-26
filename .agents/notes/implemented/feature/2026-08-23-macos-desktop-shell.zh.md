# Agent Note: 完整 Web profile 的 macOS 桌面壳

Status: implemented

[English](2026-08-23-macos-desktop-shell.md) | 中文

## Problem

随附的 `dsh web` 应用虽然只监听 loopback，却仍要求使用浏览器。本地桌面安装需要原生窗口与生命周期行为，同时不能 fork Web 客户端，也不能移除 Web profile 已经拥有的插件组合、沙箱策略、审批、设置和持久化。源码版本的变化速度也快于已签名桌面 bundle 所需的更新频率。

直接更新正在运行的源码并不安全。依赖或构建失败可能导致没有可运行版本，本地修改可能与上游冲突，而且应用不能把 Git 命令成功当作运行时已经就绪的证明。

## Decision

`desktop-shell/` 是一个面向 macOS 13 的 Swift 应用，它使用 `web --no-open --port 0` 启动构建后的 CLI，并在该地址返回 HTTP 200 后于 WKWebView 中嵌入就绪通知给出的 loopback URL。运行时 stderr 只作为诊断信息写入日志，不能替换启动展示；stdout 进度会在接受就绪行后停止。每个随机端口都会形成不同的 Web origin，因此 document-start script 会从原生偏好设置恢复浏览器的 `dsh.sessions.current` 单元，并通过仅接受主 frame 和 loopback 的 WebKit message handler 镜像后续变更。桥接只传递不透明的当前会话选择记录；会话日志、草稿、设置和插件状态仍由既有组件负责。官方 Web profile 仍是应用主体；原生代码只负责进程生命周期、本地地址导航、这项跨 origin 的选择连续性、源码选择、插件命令编排和桌面展示。原生“编辑”菜单会通过 AppKit responder chain 发送标准撤销、重做、剪切、复制、粘贴与全选操作，让当前聚焦的 WKWebView 控件处理对应的 Command 快捷键。全尺寸透明标题栏让 Web 界面保持一体化。由于 WKWebView 不会声明窗口移动，原生拖拽视图只覆盖侧边栏右侧、标题栏高度内的空白区域，并在全屏时停用。

Application Support 持有一份持久 `DSH_HOME`，用于保存会话、设置、凭据、profile 和插件；源码版本与它分开存放。修改 Web profile 的插件菜单命令会先停止可见运行时，再使用可从 `PATH` 找到的仓库固定 pnpm 版本调用官方 `dsh plugin --profile web` 入口，最后重新启动同一源码版本。因此，桌面壳保留组合包重整逻辑，不自行编辑 profile 依赖。

只有当启动失败明确指出一个 Bundle package，且该 package 是 Web profile 已启用的树外依赖时，系统才会执行自动恢复。桌面壳会创建一个临时 profile，保留 Web profile 的配置和其他全部 Bundle，链接到同一份已安装依赖树，只省略故障 Bundle，然后重试一次。它不会编辑 Web profile 或卸载 package，并会在恢复运行时停止后删除临时 profile。因此，应用下次启动仍会尝试正常插件集合。内置 Bundle 故障和无法归因的启动故障继续直接失败，避免恢复逻辑掩盖产品或整个 profile 的缺陷。

桌面壳还会在 document start 注入一个返回 Promise 的插件管理桥接，并且只接受来自 loopback 主 frame 的消息。客户端包把该桥接视为能力信号，在桥接不存在时不会注册任何内容，因此普通浏览器表面保持不变。桌面模式下，它只通过既有可追加 slot 增加一个 `sidebar.footer.action` 条目和一个 `shell.overlay` 条目，侧边栏 owner 不会被修改。桥接只列出 Web profile 的树外依赖，并在一级“社区发现”Tab 中把 GitHub `dsh-plugin` topic 与 deepseek1024.com 作为相互独立、未经信任的发现索引。两个目录分别持有搜索、分页和滚动状态，在插件库打开时并行预取第一页。GitHub 当前页使用最多四项并发结构检查；第三方来源使用其分页 API、公开分类数量和排序模式，原生端只保留短期分页缓存。Topic 仓库直接接受本机结构分类；第三方目录只贡献展示元数据，送审时原生端必须从固定站点解析公开 npm 目标，通过 npm registry 固定精确版本，再进入同一套检查。原生检查把来源分成“可直接安装的 Profile Bundle”“需要适配的包”“外部项目”和“已阻止来源”。只有固定到精确 npm 版本或 Git commit 的不可变来源具有有效根清单、声明 `dsh.bundle.patch`，且包含所引用的包内 YAML 组合入口时，原生端才会发放安装 token。已发布 npm 清单的运行时依赖字段每残留一项 `workspace:` 版本声明，审查就增加一项可覆盖风险。客户端会展示“强制安装”和“取消”选项；原生桥接只有收到 `force: true` 才会消费带风险的 token，“取消”则会撤销 token。“强制安装”仍把未经改写的包委托给 pnpm，安装可以失败，系统不会改写发布者元数据。其他 token 只能使用一次，并在 15 分钟后过期。安装与移除会在停止可见运行时期间委托给官方插件命令，安装会强制保存精确来源并禁止依赖 lifecycle script。审查、成功和失败结果都会追加到原生 JSONL 审计日志。这是一项结构与不可变来源安装预检，不是运行时沙箱、第三方目录或发布者背书，也不声称任意插件代码都是安全的。

“已安装”列表展示默认 `Deepseek-Files` 与 `@deepseek-ai/dsh-model-catalog` Bundle，从各自源码 manifest 读取精确 package 版本，并把它们标记为不能通过外部依赖控制移除。浏览器 locale 会把后者显示为“Model Capabilities”或“模型能力目录”；pi-ai 只保留为实现细节，不进入产品名称。

源码更新会获取应用声明的配置 checkout `origin` 分支，并在分离的 Git worktree 中准备目标提交。它按原 lockfile 安装依赖，构建完整仓库，使用独立探测数据启动待验证 CLI，并要求同时观察到 CLI 就绪行和 HTTP 200 响应。只有检查通过后才切换选中的源码指针。上一个指针会保留供回退使用，更新器不会重置或合并活跃 checkout。

本地应用构建会把开发者 checkout 记录为初始源码；分发构建则删除该路径，并嵌入一份只由已跟踪及未被忽略的 worktree 文件组成的压缩 Git 源码快照。首次启动会先把快照解压到 Application Support，再安装依赖并构建，因此分发应用能够运行打包时的版本，同时不会携带 profile、凭据、会话、日志、被忽略的 `.env` 文件、依赖缓存或构建者 home 路径。解压出的仓库使用 `Info.plist` 声明的分发仓库与分支执行后续分离 worktree 更新。DMG 只包含该应用和 Applications 链接；在运营方提供分发证书与 notarization 之前，签名仍是 ad-hoc。

桌面进程不自行绑定服务器。它只接受子进程产生的 loopback URL，把用户点击的外部链接留在嵌入视图之外，并在 CLI 的 dispose（资源释放）等待时间之后才把 SIGTERM 升级为 SIGKILL。Harness 文件沙箱仍完全按 Web profile 的定义组合。桌面可执行文件不启用 macOS App Sandbox，因为启动运行时和访问用户选择的工作区属于必需行为。

## Alternatives considered

**Electron。** Electron 可以提供同等的 Web 嵌入能力和成熟的更新库，但会在产品已有浏览器客户端的情况下再增加一套 Node/Chromium 分发。WKWebView 让自定义桌面壳保持较小，并使用操作系统 Web 引擎。

**Tauri。** Tauri 在 macOS 上同样使用 WKWebView，并提供跨平台打包，但它的命令与权限层会增加第二套应用框架，同时仍然需要监管 Node 运行时。无第三方依赖的 Swift 桌面壳是范围更窄的 macOS 实现。

**只使用 Docker 运行时。** 容器可以加强文件系统与进程隔离，但会把工作区访问变成挂载管理问题，依赖外部容器引擎，并与直接运行待验证源码 worktree 的做法冲突。容器执行仍可作为可选后端，但必须只监听 loopback、不挂载 Docker socket，并且只暴露用户选择的工作区和持久数据。

**直接更新活跃 checkout。** 快进并重新构建选中的源码占用磁盘更少，但构建失败会替换最后一个可用产物，也可能与本地开发冲突。分离 worktree 会同时保留两个源码版本，使回退只需切换指针。

**复用一个固定 loopback 端口。** 稳定 origin 可以在不使用桥接的情况下保留所有浏览器存储，但会让桌面启动面临不必要的端口冲突失败，并放弃由操作系统选择端口。只镜像一个导航单元既能保留随机端口，也不会把原生层的所有权扩大到任意 Web 存储。

**直接在侧边栏 owner 或浏览器 API 中加入插件控制。** 修改侧边栏会把桌面专属功能耦合到随附导航 chrome，而浏览器 Remote 会向每一种 Web 部署开放包管理器写操作。使用既有可追加 footer 与 frame slot 可以分离所有权，原生主 frame 桥接则让高权限操作只存在于桌面模式。

**在一次启动失败后持久禁用或卸载插件。** 这两种方式都会根据单次进程结果修改用户意图，还可能把临时依赖或文件系统故障变成长期配置变更。仅用于一次运行的恢复 profile 能在保持正常 profile 权威性的同时让桌面应用继续可用。

## Consequences

应用保留完整 Web profile 行为和原生插件安装能力，无需引入第二套客户端实现。插件库可以展示已安装 package、审查不可变来源、卸载 package 并展示审计记录，同时不会假装一个 package 级开关能控制该 package 贡献的多个 Cordis 条目。依赖 lifecycle script 的插件可能无法通过更安全的安装路径正常工作。故障侧载 Bundle 可能在一次恢复运行中缺席，因此其工具和 UI 在正常启动成功前不可用；其他 profile 状态仍保持权威。每次源码更新需要为另一份 checkout 和依赖树占用磁盘，旧 worktree 会保留到用户明确删除。干净探测不会加载用户的第三方插件，也不能证明迁移后的持久数据兼容，因此源码切换仍可能因无法归因到单个侧载 Bundle 的原因失败；源码回退可用，但无法撤销上游数据迁移。

应用采用 ad-hoc 签名，依赖 Node.js、Git 和首次构建所需的网络连接。打包步骤会在生成图标和签名前重新创建 bundle，避免旧资源残留在新构建中。面向一般用户分发前，仍需捆绑或安装兼容 Node 运行时，并执行运营方的分发签名与 notarization 流程。内置沙箱限制已组合 agent 工具产生的文件效果；它不会把第三方插件变成不可信代码，不限制插件的网络访问，也不提供全应用容器边界。
