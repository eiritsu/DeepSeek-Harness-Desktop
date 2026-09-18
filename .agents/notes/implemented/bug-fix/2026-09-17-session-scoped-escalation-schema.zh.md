# Agent Note: 会话范围的升级 schema

Status: implemented

[English](2026-09-17-session-scoped-escalation-schema.md) | 中文

## Problem

只要挂载了受限 backend，sandbox 工具就声明全部升级目标。已经处于 `danger-full-access` 的会话仍会收到 `sandbox_permissions` 与 `justification`，从而诱导模型生成严格扩大检查必须拒绝的请求。空或纯空白 `justification` 会在命令 body 前失败，消息变体还可能消耗多次重复工具调用。

## Decision

全局工具 definition 保留为 agentless direct caller 的完整 fallback。每个已发布 Agent 都得到同名 scoped shadow，其参数由会话生效策略决定：

- `read-only`：保留 `workspace-write` 和 `danger-full-access`；
- `workspace-write`：只保留 `danger-full-access`；
- `danger-full-access` 与无约束执行：不声明两个升级字段。

`sandbox/mode` event 会在下一次请求前刷新 Agent shadow。schema 省略只影响展示：注入的旧参数或畸形参数仍会到达原始 execute closure，并通过 `SANDBOX_ESCALATION_INVALID` 失败。真实升级时，`validateEscalationArgs` 仍是第一个工具 body 检查，在 shell 或 filesystem 执行前拒绝缺失、孤立、空或纯空白 justification。

## Alternatives considered

**保留全局目标 enum，只依赖 prompt context。** 未采用，因为模型会把 schema 当成可执行字段集合；当前策略提示不能移除无效选项。

**执行时静默丢弃同模式字段。** 未采用，因为它会隐藏模型畸形调用并削弱持久化 error/result 记录。scoped schema 防止正常生成；execute 对注入字段仍然 fail-closed。

**把条件配对校验移进通用 JSON schema。** 未采用，因为参数 DSL 没有 trim-aware 的跨属性条件。共享 helper 仍作为第一个可执行检查，并携带结构化调用方可修复错误码。

## Verification

sandbox vocabulary suite 钉住每个有效 mode 的真实目标集。bash tools suite 创建 `danger-full-access` 与 `workspace-write` 的 Agent-scoped shadow，验证 schema 省略/收窄同时保留全局 fallback，并验证注入字段得到结构化严格扩大拒绝。bash、pwsh、filesystem、sandbox、repeat-tool-reminder suites 一起运行；四个受影响 TypeScript 项目完成 typecheck。Lite Swift suite 覆盖标题栏排除区几何和旧 session 数据迁移幂等性。

## Consequences

最高 sandbox mode 下模型看不到不可能的升级动作。受限会话只看到可执行的更宽目标。用户切换 sandbox mode 时，scoped tool schema 合法变化，request header 可能开始新的 model series；session log 保留模型实际看到的 header。
