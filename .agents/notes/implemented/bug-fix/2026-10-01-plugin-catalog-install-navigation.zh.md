# Agent Note: 插件目录安装导航

Status: implemented

[English](2026-10-01-plugin-catalog-install-navigation.md) | 中文

## 问题

已安装的目录可以把包 spec 交给 Web 插件管理器，但现有导航 API 只能打开组合包详情。用户选择条目后目录关闭，却没有打开所选包的安装对话框。

## 决策

`pluginNavigation.openInstall(spec)` 会选中插件面板，将其导航 store 切回列表，并使用去除首尾空格后的 spec 打开安装对话框。不带 spec 的调用使用既有 `PluginManagerFace.openInstall()` 操作，因此官方添加按钮仍显示空输入，并保留原 analytics 事件。

其他调用方提供 spec 时，正在进行的安装保留原 spec 和进度。空闲对话框可以被替换，因为 Host 尚未收到安装请求。不带参数的调用继续重新打开隐藏任务，或保留现有对话框状态。

## 考虑过的替代方案

**让目录拥有独立的安装对话框。** 不予采纳，因为 registry 选择、Host 检查、取消、进度和恢复都属于插件管理器现有的安装流程。

**只导航到插件列表，再要求用户重新输入 spec。** 不予采纳，因为目录已知所选包的身份，可以直接交给管理器。

## 后果

目录选择现在可通过一次导航操作进入 Host 驱动的安装流程。导航 API 仅负责安装给定 spec；现有组合包导航和无参添加操作保留原有行为。

## 测试

manager-store 测试覆盖预填时去除首尾空格、无参添加操作、替换空闲对话框，以及保留正在进行的安装。browser-plugin 测试检查面板选择、列表导航和预填后的空闲安装状态。
