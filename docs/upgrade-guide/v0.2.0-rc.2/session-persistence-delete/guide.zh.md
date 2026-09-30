---
kind: upgrade-guide
description: "SessionPersistence 新增必需的抽象成员 delete()，AgentHandle 新增必需的 disposeIfIdle()；仓外子类和 handle 字面量将无法编译。"
---

# `SessionPersistence` 要求实现 `delete()`，`AgentHandle` 要求实现 `disposeIfIdle()`

[English](guide.md) | 中文

## 变更

v0.2.0-rc.2 新增会话物理删除。两个已发布的接口各增加一个必需成员：

- `SessionPersistence` 声明 `abstract delete(id: SessionId): Promise<void>`，用于移除一个已存储会话及其全部已提交格式代次。`JsonlSessionPersistence` 已实现。
- `AgentHandle` 声明 `disposeIfIdle(): Promise<boolean>`，用于封存 Agent、使其不再接受新输入，并仅在 Agent 空闲且无排队工作时释放。

两者都是 TypeScript 接口，因此仓外继承 `SessionPersistence` 或构造 `AgentHandle` 字面量的包会停止编译，报 `TS2515` 或 `TS2739` 并指出缺失的成员。不子类化、不构造这些类型的使用者，运行行为不变：除非调用方主动请求，否则不会删除任何会话。

## 迁移

1. 在自定义 `SessionPersistence` 子类中实现该接口。id 不存在时不做写入直接返回，会话仍被写入者持有时拒绝：

   ```ts
   async delete(id: SessionId): Promise<void> {
     if (!this.entries.delete(id)) throw new SessionPersistenceNotFoundError(id)
   }
   ```

2. 在构造 `AgentHandle` 字面量的代码中补上该成员。返回 `false` 表示不改动 Agent，适合测试替身：

   ```ts
   const handle: AgentHandle = {
     agent,
     disposeIfIdle: () => Promise.resolve(false),
     dispose: () => Promise.resolve(),
   }
   ```

3. 确认：`pnpm run typecheck` 不再报告缺失的 `delete` 或 `disposeIfIdle` 成员，且 `pnpm run test` 通过。内建的 `JsonlSessionPersistence` 与 Agent Loop handle 已具备这两个成员。
