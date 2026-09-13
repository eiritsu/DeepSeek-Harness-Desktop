---
description: "面向桌面部署的 SQLite 会话持久化，用于提供单一权威数据库、事务追加、低成本列表元数据与便于备份的存储。"
kind: "package-reference"
---

# @deepseek-ai/dsh-session-persistence-sqlite

[English](README.md) | 中文

## 概述

`dsh-session-persistence-sqlite` 把会话 header 与事件存入同一个 SQLite 数据库。它在一个事务内提交每批事件及其计数，以完整同步模式运行 WAL，并提供与 JSONL provider 相同的 handle API。当桌面 profile 需要单一权威、便于备份的存储，而且不要求每个会话拥有单独文件时，应选择它。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

在 Session 服务之后挂载本 provider，并提供一个数据库路径。一个组合必须只挂载一个 `SessionPersistence` provider。

```yaml
- name: '@deepseek-ai/dsh-session'
- name: '@deepseek-ai/dsh-session-persistence-sqlite'
  config:
    path: /absolute/path/to/sessions.sqlite
```

| 字段 | 默认值 | 含义 |
|---|---|---|
| `path` | 必填 | SQLite 数据库文件；`:memory:` 用于测试 |

新会话在第一次事件批次或显式 `flush` 之前只存在于当前进程。第一次持久写入会在同一事务中插入 header 与事件。后续 append 会校验已存储的下一个序号、插入连续批次，并在事务提交前更新 `event_count`、`revision` 与 `updated_at`。`stat` 和 `list` 无需加载事件正文即可读取存储计数。

后端以仅所有者权限创建缺失的父目录和数据库文件。它启用外键、WAL journal 与 `synchronous=FULL`。Schema 版本 `1` 会先为未标记的桌面 schema 增加 lineage、计数与 revision 列，再写入 `PRAGMA user_version`。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

该 provider 拥有一个 `DatabaseSync` 连接。元数据行保存不可变会话 header、继承前缀长度、事件计数与 revision。事件行以 `(session_id, seq)` 为主键，并随元数据级联删除。每个写 handle 在一条 Promise 链上串行执行显式 append 和已路由实时事件排空；服务会把 `session/event`、`session/flush` 与 `session/disposed` 路由到对应会话 id 的当前 writer。

读取会解析持久 JSON，检查请求 id 与当前 Session 格式版本，要求行序号和 payload 序号连续，并运行共享的 fail-closed 事件校验器。返回事件 graph 在 handle 报告 `shared-frozen` 所有权之前会被深度冻结。

| 文件 | 作用 |
|---|---|
| [`src/index.ts`](src/index.ts) | Schema 设置、后端服务、会话 handle、实时事件路由与 teardown |
| [`tests/sqlite.spec.ts`](tests/sqlite.spec.ts) | 共享 persistence/live-write contract 与 SQLite 元数据覆盖 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [会话持久化子系统](../../../docs/subsystems/persistence.zh.md)——与 provider 无关的 handle、持久性与恢复语义。
- [会话持久化 seam](../session-persistence/README.zh.md)——本 provider 实现的 API。
- [JSONL provider](../session-persistence-jsonl/README.zh.md)——支持已发布格式迁移的逐会话文件替代方案。

-----

<a id="model-experience"></a>
## 模型体验

### 恢复的对话历史

#### 模型会看到什么

SQLite 不贡献 prompt 文本。恢复后的 lifecycle 会重建任一合规 provider 所暴露的同一组已校验 `SessionPersistence` 事件。

#### Token 影响

除恢复的对话历史与当前请求 envelope 外，实时请求 token 增量为零。

#### KV Cache 影响

存储选择不改变请求前缀。Cache 复用取决于重建历史、当前 envelope 与选定模型路由。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **只接受已安装的迁移**——provider 会通过格式 catalog 升级已识别的旧桌面 schema 与已发布 Session 格式，但会拒绝未知布局和更新格式。
- **每个 backend instance 只允许一个 writer**——同一 Host 中的第二个写 handle 会被拒绝。跨进程排斥由应用所有；两个桌面壳都会在启动 Host 前持有 `$DSH_HOME/desktop/runtime.lock`。
- **删除具有事务性**——`delete(id)` 会拒绝活动 writer，并在 `BEGIN IMMEDIATE` 内删除 metadata 行；foreign-key cascade 会在 commit 前移除其事件。
- **WAL 会创建伴随文件**——备份操作必须 checkpoint 并关闭 Host 后再复制数据库；在数据库运行时只复制主文件可能漏掉已提交页面。

本包不发布运行时 invariant companion；持久读取会直接验证权威数据库，事务与生命周期行为由聚焦持久化契约覆盖。

<a id="dev-note"></a>
### 开发备注

两个桌面壳现在已具备共享的进程生命周期锁、已发布 Session 格式迁移和关闭 Host 后的备份/导入流程。最旧/最新平台的安装包验证仍属于发布工作。
