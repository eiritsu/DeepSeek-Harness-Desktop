# Agent Note: Physical Session deletion

English | [中文](2026-09-29-physical-session-deletion.md)

## Problem

归档会让 Session 从导航中消失，但会保留 transcript。用户需要一个独立操作，真正移除已存储 transcript，既不留下一份隐藏副本，也不隐式停止工作或删除其他 Session 可能使用的数据。

## Decision

`WorkspaceRegistry.deleteSession(sessionId)` 是明确且不可逆的删除操作。它会先阻止新的 Session Controller resolve，再拒绝 `workspace/session-activity` 报告为活动的 Session；它不会发出 stop 或 cancel 请求。Session Controller 保留自身创建的 `AgentHandle` 能力；该句柄会原子封住输入，并且只有 Agent 空闲且 Inbox 为空时才会关闭。未归其所有的实时 Agent、活动工作与排队输入均保持不变并阻止删除。随后 JSONL 持久化会在本进程内认领该 id，获取 writer 使用的同一跨进程 `session.lock` lease，然后从最旧 generation 开始、最高 generation 最后移除规范 generation 文件。即使普通读取会拒绝混合编码的 root，删除也会识别两种受支持的文件名编码。它不会递归进入目录、移除附件或级联删除 fork 子会话。

格式迁移仍是独立操作：它会发布相邻的新 generation，并保留前代 generation。只有明确调用整 Session 的 `SessionPersistence.delete(id)` 才会移除已提交 generation；迁移和版本/状态规则从不授权删除 generation。

删除成功后，JSONL 提供方会保留空的每会话目录和 `session.lock`。POSIX 锁关联的是 inode；删除该文件会让新 writer 锁定替代 inode，而旧进程仍持有原 inode。锁文件不含 transcript 数据，也不会被识别为可见 Session generation。

物理删除后，注册表会解除 Workspace 成员关系、删除归档与置顶引用，然后清除缓存的 header 并发出 `workspace/session-deleted`。API 会将它转发为打开中的 Client Session 所接收的 `api-session/removed`；Workspace feed 会收到注册表变更。查询索引在提供查询前，会把缓存的持久化 identity 与最新持久化列表重新核对。子会话保留原来的 `parentSession` 元数据和自己的 generation。

如果移除文件时发生错误，只要最高 generation 尚未被移除，它就仍可读取。若拥有的 idle Agent 已关闭但物理删除失败，admission reservation 会释放，后续操作可重新恢复仍持久化的 Session。最高 generation 一旦 unlink，该 reservation 就变为 tombstone，即使 Workspace 引用清理失败也是如此；再次以同一 id 请求时，会把存储缺失视为物理步骤已完成，重试引用清理并重新发布事件。如果事件监听器抛错，部分监听器可能已经收到事件。目录同步失败时 transcript 字节可能已经消失，但 RPC 只有在注册表清理和事件发布完成后才报告成功。

## Alternatives considered

**把归档当作删除。** 归档是可恢复的导航状态，会保留 transcript；若将它呈现为删除，就会把用户期望移除的数据隐藏起来。

**删除时停止活动工作。** 删除不得默默取消用户工作。活动状态拒绝让调用方要求用户先停止；持久化锁还会独立拒绝另一个进程中的 writer。

**移除会话目录与锁文件。** 删除锁 inode 会让跨进程 writer 排他性分裂到旧 inode 和替代 inode。未来设计证明可安全回收目录之前，保留无害的空目录。

**级联删除 fork 子会话或共享附件。** 子会话拥有自己的 transcript，源会话删除后仍可能有用；附件也可能共享。该操作只移除目标 id 独占目录中的 generation 文件。

## Consequences

成功 unlink 的 generation 不可恢复。进程崩溃或 I/O 错误可能导致较旧 generation 部分移除，但最高 generation 最后移除；重试会完成操作。最高 generation unlink 后、目录同步前发生进程崩溃时，文件系统持久性取决于平台。元数据清理可在重试时幂等完成，保留的锁 inode 可维持同 id 协调稳定。

定向 persistence、真实 AgentLoop/JSONL Host、registry、RPC 和 Client 测试覆盖物理文件、锁所有权、活动与排队工作拒绝、idle 当前 Agent 拆除、fork 子会话保留、引用、重试和移除事件。Keyless Session snapshot 描述模型可见的 replay，无法表示控制面删除或文件系统变更；本功能没有更改模型输入或 Session event，因此由定向测试作为验收证据。
