# DeepSeek Harness Windows 桌面版

Windows 壳使用 Electron 和 Chromium WebView，复用 DSH 的 Web UI 与 Node 运行时。它负责启动 `dsh --profile web`、加载 loopback 页面、目录选择、外链打开和应用退出清理。

开发构建需要 Node.js 22 或更高版本，并先在仓库根目录完成 `pnpm run build`。在本目录执行 `npm install` 后运行 `npm start`。Windows 发布构建执行 `npm run dist`，构建脚本会部署 CLI 的 production workspace 依赖和前端静态资源，因此安装后的应用不依赖源码仓库或开发机的 `node_modules`；产物包括 NSIS 安装包和 portable 便携版。

MCP、插件配置、工具与连接等功能仍由共享 Web UI 和 DSH 插件层提供；Windows 壳只实现平台能力，不复制业务逻辑。后续接入原生插件桥接时，应保持和 macOS 的请求语义一致，并继续使用 context isolation。
