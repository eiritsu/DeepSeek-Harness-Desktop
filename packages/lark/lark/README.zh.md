---
description: "DeepSeek Harness 的 Lark/飞书应用管理、官方 CLI 工具与持久化私聊 Session。"
kind: "package-bundle"
---

# @deepseek-ai/dsh-lark

[English](README.md) | 中文

## 概述

`dsh-lark` 把官方托管或自建 Lark/飞书应用连接到 DeepSeek Harness。它通过 DSH Credentials 保存秘密值，运行经过校验的官方 CLI，注册模型可见的 `lark_cli` 工具，并把已授权用户的私聊映射为持久化 Harness Session。桌面 profile 会同时挂载本包与独立的 Client 设置包。

## 目录

- [使用这个包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延后工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用这个包

在组合中挂载本包，然后在设置中打开“Lark 管理”。官方快速连接通过 Lark Channel SDK 创建应用，再继续当前用户 OAuth。高级方式接受已有 App ID 和只写 App Secret。两个路径都把 OAuth 与 CLI 状态隔离在 `$DSH_HOME/lark-cli`；经过校验的官方 CLI 二进制安装在 `$DSH_HOME/lark-cli-bin`。

```yaml
- name: '@deepseek-ai/dsh-lark'
```

应用权限与当前用户 OAuth 是两种独立授权。设置页分别报告两个身份和缺少的 scope。复制操作直接把批量权限模板写入剪贴板，不在页面渲染 JSON。自建应用还必须启用长连接事件订阅并订阅 `im.message.receive_v1`。

私聊接入默认启用。`conversationUserOpenId` 把入口限制为已授权用户；群聊与其他发送者不会进入 Agent。`conversationCwd`、`conversationTimeZone`、握手/响应 timeout、CLI deadline、输出上限与连接开关都是经过验证的 Cordis 配置字段。空的 `conversationCwd` 会使用并创建 `$DSH_HOME/workspaces/lark`，因此新会话不会再把应用 bundle 或源码 checkout 继承为 Workspace。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部细节 — 点击展开</summary>

Host 公开类型化 `larkManagement` Remote service，并把 App Secret 与未完成 OAuth 状态保存在 Credentials。经证明为只读的官方 CLI 命令可以直接执行；其他命令进入普通 DSH approval 流程。CLI secret 通过 stdin 传递，不会进入 argv、renderer 响应或日志。

每个 `(App ID, chat ID)` 映射到一个稳定 Session。收到的文本、下载的文件与已识别附件文本都会连同 Lark message/sender 标识写入日志，因此平台重投同一 message ID 时不会再次提交。新聊天使用 `conversationCwd` 与当前默认模型；稳定默认 Workspace 首次创建时会按配置品牌命名为“飞书”或“Lark”。恢复的聊天保留已持久化 cwd、Workspace 成员关系、Session ID 和模型。文本与结构化文件/图片附件回复会返回原消息。teardown 会停止接收、等待在途工作、断开 Channel 并释放插件创建的 Agent。

| 文件 | 作用 |
|---|---|
| [`src/index.ts`](src/index.ts) | settings、credentials、Remote 方法、CLI 工具与审批门禁 |
| [`src/conversation.ts`](src/conversation.ts) | 私聊生命周期、持久化 Session 映射、附件与回复 |
| [`src/permissions.ts`](src/permissions.ts) | capability scope 与导入模板 |
| [`vendor/larksuite-cli`](vendor/larksuite-cli) | 有 checksum 的跨平台官方 CLI launcher |

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

- [Lark Client 设置](../../client/ui-lark/README.zh.md) — 浏览器管理界面。
- [Session 持久化](../../session/session-persistence/README.zh.md) — 私聊使用的持久事件权威来源。
- [附件](../../attachment/attachment/README.zh.md) — 文件存储与识别 seam。

-----

<a id="model-experience"></a>
## 模型体验

### 官方 CLI 与私聊输入

#### 模型看到的内容

工具目录包含接受字符串数组命令参数的 `lark_cli`。私聊文本作为已记录用户消息进入；文件作为结构化 attachment block 进入，并在可用时带有识别文本。App Secret、OAuth device code、权限模板 JSON 与原始 CLI 配置不会进入模型上下文。

#### Token 影响

工具结果与附件识别文本和其他已记录工具/用户内容一样占用上下文。除非用户明确要求 Agent 查询 Lark，否则配置与权限状态不占用 token。

#### KV Cache 影响

稳定工具声明可被缓存。聊天特定文本、附件与 CLI 结果会随 turn 变化，并扩展 Session transcript。

## 已知限制与延后工作

<a id="known-limitations-and-deferred-work"></a>

- Lark 服务可用性、应用审批、scope 和长连接投递仍是外部依赖。
- 内置 CLI checksum 表只支持经过审查的 Darwin、Linux 与 Windows 目标；升级上游 CLI 需要同步更新 checksum 与打包。
- 私聊入口有意只接受每个应用配置的一个授权 Open ID，不接受群聊。

本包不发布运行时 invariant companion；除由 Session、工具、凭据和设置服务各自检查的关系外，gateway 不暴露独立的持久关系。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>面向维护者的工作上下文 — 点击展开</summary>

本包从桌面分支移植到当前 Settings、SessionQuery、Attachment、Typert 与 lifecycle API。不要恢复已删除的 package-root `dsh.client` 声明；Client 包由当前组合挂载。

</details>
