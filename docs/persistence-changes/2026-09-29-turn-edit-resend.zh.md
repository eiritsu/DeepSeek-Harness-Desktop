---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-09-29-turn-edit-resend

[English](2026-09-29-turn-edit-resend.md) | 中文

## 概述

为 `agent/inbox/spliced.data` 增加可选的 `replacements` 字段，并新增三个仅日志事件 `turn-resend/requested`、`turn-resend/request-started`、`turn-resend/settled`，用于记录一次编辑重发尝试。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

```yaml persistence-change
schemaVersion: 1
id: 2026-09-29-turn-edit-resend
baseline: false
changes:
  - root: "event:agent/inbox/spliced"
    previous: "2026-09-16-session-format-v4"
    after: "d407e975f1520a7b28fbf6bc0f28aebf8a3bfbefed059fc26992a23364cd91b3"
    decision: same-version
  - root: "event:turn-resend/request-started"
    previous: null
    after: "a905b4966f75da47cf8440bbb0dea1b40f3a800d6df27a62e045ba590949fa17"
    decision: same-version
  - root: "event:turn-resend/requested"
    previous: null
    after: "f6c551984308611eafd933f73a031410cd9ad4b3d456876e903212164bc83af4"
    decision: same-version
  - root: "event:turn-resend/settled"
    previous: null
    after: "0eefec399ea3aa0f91a07126d03deb32ff3a209a909da21fe38123aa4c27bae1"
    decision: same-version
```

<a id="compatibility"></a>
## 兼容性

同版本。新增的 `replacements` 字段为可选，因此此前写入的日志重放不变；三个新根仅由挂载的 `dsh-session-turn-edit-resend` Host 服务写入，未加载该包的构建会按未知事件类型的必读规则拒绝含有它们的日志。

<a id="verification"></a>
## 验证

Bundle 与 agent-loop 套件的聚焦单元测试固定了重发 splice、操作日志折叠与请求前 flush 屏障；生成的 `known-event-types` 列表与持久化目录包含这些新根。

<a id="dev-note"></a>
## 开发备注

无。
