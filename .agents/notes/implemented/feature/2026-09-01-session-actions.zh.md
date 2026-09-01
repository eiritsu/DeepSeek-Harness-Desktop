# Agent Note: 会话删除与工作区操作

状态：已实现

[English](2026-09-01-session-actions.md) | 中文

## Problem

上游会话重构保留了重命名、分叉和归档，却漏掉了重构前 Harness 已有的永久删除路径。因此侧边栏没有删除入口，Host 也没有能够安全清理会话及其后代的生命周期路径。

## Decision

永久删除作为 Session Controller 命令实现。Host 从持久化会话和活动会话建立统一的 header 索引，拒绝不存在的根会话和非递归的后代删除请求，预检运行中或被子代理占用的 Agent，释放保留的活动句柄，通过持久化协调器删除耐久记录，并从所有工作区移除已删除 id。客户端 manager 根据返回的删除列表投影移除，并在删除当前会话时清空选择。

工作区浏览器按“重命名、分叉、归档、加入工作区、删除会话”的完整顺序提供会话操作。“加入工作区”复用现有 Workspace 实体校验和 Host 命令，因此会话目录与工作区目录保持一致，不会产生仅 UI 可见的虚假成员关系。

## Consequences

删除按子会话到父会话的顺序执行，不会留下指向已删除存储的活动 Agent 或工作区成员关系。该操作不可逆，并通过确认对话框保护。归档与删除保持独立，归档会话仍保留持久化日志。

## Alternatives considered

**隐藏入口并要求手动清理文件。** 这样会让活动 Agent、投影和工作区成员关系不一致。

**只删除当前会话日志。** 这样会遗留分叉或子代理创建的持久化后代。

## Verification

持久化、Session Controller、Workspace Controller 和 workspace-browser 定向测试通过；变更涉及的 Host 和 Client 包 TypeScript 构建通过。替换已安装桌面 App 前仍需执行 desktop-shell 构建 smoke。
