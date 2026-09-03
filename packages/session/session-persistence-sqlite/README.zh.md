---
description: "为桌面数据库提供持久化会话 SQLite 存储，并说明 durable event log 配置。"
kind: "package-reference"
---

# @deepseek-ai/dsh-session-persistence-sqlite

[English](README.md) | 中文

`dsh-session-persistence-sqlite` 把每个会话 header 和连续的 `SessionEvent` 行存入一个 SQLite 数据库。它复用共享 persistence coordinator，因此会话创建、追加顺序、恢复准备、崩溃收尾、revision 和删除与 JSONL 后端保持相同语义，同时让桌面数据库成为唯一持久化介质。

## 概述

后端把逻辑会话流保存为 SQLite 行，并由共享 coordinator 负责生命周期和写入顺序。桌面部署需要一个 owner-controlled 数据库、而不是每会话一个 artifact 时，使用这个后端。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>
## 使用本包

在桌面 profile 中挂载该后端。它注册 `ctx.sessionPersistence`，并在一次性导入期间保留旧 JSONL 文件作为回滚来源。

## 配置

```yaml
- id: session-persistence-sqlite
  name: '@deepseek-ai/dsh-session-persistence-sqlite'
  config:
    path: /path/to/dsh-desktop.sqlite
    legacyRoot: /path/to/legacy/sessions
```

`path` 必填。设置 `legacyRoot` 后，已有 JSONL 会话会在第一次 SQLite 读取前导入一次；导入标记保存在 SQLite 中，后续启动保持幂等。后端会创建父目录，启用 WAL 与 full synchronous 提交，并在 POSIX 文件系统上把数据库文件权限限制为 owner-only。

<a id="understand-the-implementation"></a>
## 理解实现

共享 `PersistenceCoordinator` 负责批处理、序列检查、崩溃 closer 与生命周期释放；该 provider 负责 SQLite schema、事务、revision 以及幂等的旧数据导入。

<a id="further-exploration"></a>
## 进一步探索

- [会话持久化服务](../session-persistence/README.zh.md)
- [桌面数据迁移笔记](../../../.agents/notes/implemented/architecture/2026-09-03-desktop-application-support-data-and-plugin-management.zh.md)

<a id="model-experience"></a>
## 模型体验

SQLite 不增加提示词内容或模型可见字段。恢复会话时，事件历史与请求元数据和 JSONL provider 保持一致。

### 会话恢复

#### 模型看到什么

重启后模型看到的仍是相同的会话事件与请求元数据；SQLite 只是实现细节。

#### Token 影响

存储后端不会增加额外 token。

#### KV Cache 影响

后端不修改请求前缀，缓存复用遵循所选模型 provider 的正常规则。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与延期工作

- 后端为 `readRaw` 导出提供重建的 JSONL 视图；SQLite 行仍是权威数据。它不提供每会话独立 artifact 路径。旧 JSONL 文件会保留不动，便于回滚恢复。

<a id="dev-note"></a>
### 开发备注

桌面迁移会把 settings、credentials、workspace、profile、plugin、skill 与 model catalog 载荷镜像到 SQLite。session、settings、credentials 与 storage unit 已经在运行时使用数据库；profile、Skill、plugin audit 和 source-release owner 在完成事务性迁移前仍保留文件兼容。
