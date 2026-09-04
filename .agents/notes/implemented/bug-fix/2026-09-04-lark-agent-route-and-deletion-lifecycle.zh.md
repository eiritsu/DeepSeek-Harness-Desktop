# Agent Note: Recover Lark Agent routes and release idle lifecycles

Status: implemented

[English](2026-09-04-lark-agent-route-and-deletion-lifecycle.md) | 中文

## Problem

桌面模型设置可能在飞书会话 Agent 创建之后才写入。该 Agent 会一直保留创建时为空的 provider/model 选项，因此后续消息在适配器分发之前就会失败，即使 Web 客户端显示了有效模型。Lark bridge 还会无限期保留自己创建的空闲 Agent 句柄，导致会话控制器按设计拒绝另一个生命周期所有者发起的删除。

## Decision

Lark bridge 为每个由它创建或发现的 Lark Agent 安装 `agent/request` 兜底。当请求仍未路由时，listener 读取当前进程默认选择并补上 provider/model，同时保留显式路由和推理等级。Lark 创建的句柄在该会话最后一条在途消息结算后释放；下一条消息从持久化会话记录恢复。属于其他客户端的 Agent 永不由 bridge 拆除，但 bridge 会释放自己添加的作用域上下文。

## Alternatives considered

**模型设置变化后立即重建所有无路由 Agent。** bridge 不能安全替换 Web 客户端拥有的 Agent，替换实时生命周期也会与在途轮次竞争。请求时兜底使用了专门为延迟路由提供的扩展点。

**允许会话控制器在删除时强制拆除任意外部 Agent。** 这会削弱 AgentHandle 的所有权保证，并可能终止其他传输正在执行的工作。释放空闲的 Lark 自有句柄可以保持现有所有权规则。

**每个聊天保留一个持久 Lark Agent，再增加专用删除 RPC。** 这会引入第二套跨组件删除协议，而且仍然存在陈旧所有权窗口。每条消息重新打开持久会话的成本有界，并能让工作结束后的普通删除继续使用现有流程。

## Consequences

在默认模型配置之前创建的旧飞书会话，现在可以直接使用当前默认路由，不必手动切换推理等级。UI 中的 `Default` 推理选项仍表示由提供方决定，并不表示模型不支持该选项。Lark Agent 只在处理消息期间保持活动，因此已完成的会话不会再阻止用户删除。代价是后续每条消息都要从持久化存储恢复一次，不再跨空闲期缓存内存 Agent。

Lark 会话测试覆盖路由兜底、持久化重投、附件处理、外部 Agent 配置以及空闲句柄释放。将插件产物纳入桌面发布前，必须通过包级 typecheck 和聚焦的会话测试。
