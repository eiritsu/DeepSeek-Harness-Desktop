---
kind: bug-fix
status: implemented
---

# 桌面发行版内置已验证运行时与自研插件

[English](2026-09-02-desktop-release-bundled-plugins.md) | 中文

macOS 分发构建现在显式读取旁置的 DeepSeek Plugin checkout，复制五个运行时/client 包及其已构建产物，重新生成快照 lockfile，并把这些包加入 CLI 安装锚点。仅用于发行的 Web profile 模板会启用插件库、Deepseek-Files Office 识别、Lark 与 model-catalog Bundle，因此新安装不依赖用户本地 profile 或绝对 `file:` 依赖。

打包源码快照携带已验证的 CLI 与 Web 产物，并排除 Git 元数据、测试、快照、source map、治理文件和仅开发使用的文档。构建审计会拒绝缺少插件包、构建者路径、私钥，以及未挂载全部内置插件的发行 profile。应用元数据把源码更新指向包含 session-persistence 注入修复的本地适配分支。

DMG 打包 smoke 会使用 frozen lockfile 安装快照，确认 CLI 可以启动，并验证生成的 Web profile 能解析全部内置层。
