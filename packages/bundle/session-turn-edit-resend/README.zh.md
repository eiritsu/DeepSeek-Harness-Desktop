---
description: "为 dsh --profile 增加“编辑并重发最近一条可替换回合”能力的 Bundle 层。"
kind: "package-bundle"
---

# @deepseek-ai/dsh-session-turn-edit-resend

[English](README.md) | 中文

## 概述

本 Bundle 的 Host 服务判定某个 Agent 最近一条可替换回合能否编辑，并用编辑后的提示词替换该回合的模型可见表面范围。每次尝试都以调用方拥有的 `operationId` 记入 Session 日志，因此重复提交由日志作答，而不会再次调用模型。原事件保留在追加式日志中。`web` profile 叠加本 Bundle：浏览器一半提供编辑入口，并用就地编辑器取代该消息。运行过工具的回合仍可编辑，入口会披露重发可能重复其副作用的工具。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发说明](#dev-note)

<a id="use-this-package"></a>
## 使用本包

将 `session-turn-edit-resend` 行与实时 Agent 服务一起挂载。该服务是 `turnResend` Remote 命名空间下的 `TypertRemoteService`。`web` profile 叠加本 Bundle 并挂载其浏览器行 `@deepseek-ai/dsh-client-ui-turn-edit-resend`，它在最近一条可替换回合上提供编辑入口。

`check(agent)` 报告该 Agent 最近一条回合当前能否编辑：composer 用于预填的提示文本、其回合号、首个被替换的 seq，以及该回合调用的工具名。`submit(agent, request, signal)` 替换该回合。拒绝要么是活动阻塞（`agent-busy`、`inbox-pending`、`aborted`），要么是选择拒绝（`no-replaceable-turn`、`not-latest-turn`、`no-human-prompt`、`no-editable-text`）。

### 何时回合可编辑

Agent 必须处于空闲且没有待处理输入，并且其最近一条回合的结束状态允许本功能替换：由循环正常完成，或由用户取消。出错、被阻塞、因输出 token 上限截断，或因崩溃遗留、fork 边界而关闭的回合不可替换。`check` 读取当前状态，并不对之后的 `submit` 作任何承诺；`submit` 在拥有 Agent 空闲阶段时会再次选择目标。

运行过工具的回合仍可编辑，其工具名随 `check` 返回。替换会在模型可见表面遮蔽该回合的工具调用、其结果与其旧回答，而追加式日志保留每一条记录。重发要求模型再次调用这些工具，因此浏览器入口在提交前向用户确认该重复；保持可编辑是产品决定，披露即是保障。

### 提交一次编辑

`submit` 以 `request.operationId` 保证幂等。已记录的标识返回其记录，因此重复提交绝不会产生第二次模型请求。编辑后的消息复用原提示词的非文本内容：附件与图像块，以及插件据其派生的任何后续文本块，都会原样进入替换消息。

<a id="understand-the-implementation"></a>
## 理解实现

### 选择

[`src/policy.ts`](src/policy.ts) 将 `resendTurn` host-only projection 与当前 `session.surface.nodes` 结合使用。projection 保留最近的回合边界、首个直接人类提示词及工具名；表面节点提供替换范围，该范围从此提示词开始并排除预留的系统头部。`resendJournal` projection 折叠操作记录与替换准入证明，registry 会为恢复的 session 重建这两个单元。

### 持久操作日志

[`src/journal.ts`](src/journal.ts) 折叠三个仅日志事件。`turn-resend/requested` 记录调用方标识与目标。`turn-resend/request-started` 记录重发消息已持久入队，这是模型请求从此可达的时间点。成功的重发没有进一步事件：重发消息以 `surfaceOp` 替换进入表面本身即是证明，因此即使进程在写入其他任何内容之前停止，该操作也会重放为 `admitted`。请求已开始但没有该证明的操作重放为 `uncertain`，Harness 绝不通过重复调用来消解不确定性。拒绝记录为 `requested`/`settled` 对。

### 原子准入与 flush 屏障

`submit` 通过 `runMaintenance` 在选择、消息追加与两个操作事件期间持有 Agent 的空闲阶段；在决定与提交之间不会有回合开启，也不会有其他提交进入。随后它在释放该阶段前 flush Session。驱动器的唤醒由 `runMaintenance` 在 flush 落定后释放，因此模型请求无法在持久 `request-started` 记录存在之前到达 provider。

<a id="model-experience"></a>
## 模型体验

### 回合编辑与重发

#### 模型看到什么

`Session.deriveMessages()` 在被遮蔽回合原处返回编辑后的提示词；原事件仍留在日志中。替换会开启新的请求序列，因此 provider 将该编辑后的回合视为全新上下文。

#### Token 影响

被遮蔽回合的提示词与回答离开派生请求；编辑后的提示词及其新回答进入其中。被替换范围之前未改变的前缀仍可复用 provider 缓存。

#### KV Cache 影响

被替换范围之前未改变的前缀可复用其缓存。替换及其之后的一切都是新 token。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

本包不发布 runtime invariant companion，因为回合资格与操作状态都是从同一追加式 Session 日志投影而来；再做一次折叠只会重复已注册的 projection，无法比较彼此独立的运行时观察。

- **外部副作用可能重复。** 工具回合可编辑，因此重发可能重新运行副作用在 Harness 之外的工具。浏览器入口披露工具名并要求确认；Harness 不回滚文件、进程或任何其他外部状态。
- **无跨进程协调。** 空闲阶段声明是进程本地的。共享同一 Session 存储的两个 Host 不会被串行化。
- **不确定结果即终态。** 已记录但从未准入的请求绝不重试，即使调用方重复同一 `operationId`；调用方必须提交新标识才能重试。
- **未断言 flush 参与。** 屏障将模型请求排在 `sessions.flush` 之后。没有持久化监听者的 Session 会空 flush，因此只有进程内追加顺序保护该记录。

<a id="dev-note"></a>
### 开发备注

[Host 测试](tests/host.host.spec.ts) 覆盖资格判定、工具回合拒绝、原子准入、flush 屏障、操作标识、重启重放、附件保留与被替换范围。`src/types.ts` 是面向浏览器的契约出口：它只导入叶子模块，不合并任何 cordis `Context`，因此 Client 程序读取该词汇时不会加载 Host 的 `SessionStore` 合并；[contract-face.spec.ts](tests/contract-face.spec.ts) 守护这一分离。
