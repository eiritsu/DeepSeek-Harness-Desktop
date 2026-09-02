# Agent Note：会话删除声明持久化依赖

Status: implemented

[English](2026-09-02-session-delete-persistence-injection.md) | 中文

## Problem

Session Remote 暴露了删除操作，但 Host 服务没有在注入列表中声明 `sessionPersistence` 服务。因此 Gateway 分发在命令执行前就失败，会话 runtime 持久化产物也不会被删除。

## Decision

`SessionController` 与其他 Host 依赖一起声明 `sessionPersistence`。现有删除命令继续负责删除：live Agent 退出后删除配置的 runtime 持久化产物，不发起 PostgreSQL 删除。

## Alternatives considered

**通过可选查找读取持久化服务。** 不采用：删除操作必须依赖持久化服务，缺少必需依赖时应在服务组合阶段失败，而不是延迟到可选查找后才隐藏问题。

**由 Session Remote 删除数据库记录。** 不采用：持久化 seam 负责自己的后端产物，本仓库没有 PostgreSQL 会话持久化 provider，数据库数据应保持不变。

## Consequences

Gateway 删除请求可以到达命令并删除用户 runtime 卷中的会话产物。PostgreSQL 记录保持不变；需要数据库保留或清理策略的部署必须单独管理。
