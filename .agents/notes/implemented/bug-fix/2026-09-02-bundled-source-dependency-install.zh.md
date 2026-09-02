---
kind: bug-fix
status: implemented
---

# Agent Note：启动内置源码前安装工作区链接

状态：已实现

[English](2026-09-02-bundled-source-dependency-install.md) | 中文

## 问题

发行版应用会解压已构建的 Harness 产物和 lockfile，但为了保持可移植性会省略 `node_modules`。源码准备阶段只要发现 `apps/cli/lib/bin.js` 和 Web 前端存在就提前返回，首次启动因此会在 pnpm 创建工作区链接前导入 `@deepseek-ai/dsh-app-boot`，并以 `ERR_MODULE_NOT_FOUND` 退出。快照还缺少原生启动器入口生成的 JavaScript 产物，首次安装依赖后沙箱提供方仍可能无法加载。

## 决策

源码准备阶段现在会在存在 lockfile 时检查 CLI 下的 `@deepseek-ai/dsh-app-boot` 链接。发行快照缺少该链接时，使用固定版本的 pnpm 执行 frozen install，然后直接启动已有产物，不重复构建。发行打包还会把原生启动器入口的已构建 JavaScript 产物复制到快照。无 lockfile 的测试 fixture 保留原有的仅检查产物路径。

## 结果

全新发行版会在首次运行前创建工作区链接，沙箱提供方也能解析原生启动器入口；已经准备好链接的开发源码树不会重复安装。快照仍然不包含机器相关的 `node_modules`，保持可移植性。
