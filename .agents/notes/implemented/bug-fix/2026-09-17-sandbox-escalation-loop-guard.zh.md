# Agent Note: 沙箱升级拒绝循环守卫

Status: implemented

[English](2026-09-17-sandbox-escalation-loop-guard.md) | 中文

## Problem

生效沙箱模式已是 `danger-full-access` 的会话仍然会在 `bash`/`pwsh`/文件系统工具 schema 中看到升级字段（schema 是全局注册的；执行时的严格扩大检查才是安全边界——[沙箱 note](../feature/2026-07-06-sandbox.zh.md) 已接受过度请求）。本次修复所关闭的生产循环：模型反复携带交替目标（`danger-full-access`、`workspace-write`）请求 `sandbox_permissions`，每次调用都在执行前以同一类拒绝失败，八分钟内累计十一次失败，唯一的打断是一条建议性提醒。

两个源码事实使循环成为可能：

1. 升级拒绝抛出的是普通 `Error`。工具注册表只从 `HarnessError` 子类提取 `{name, code}`，因此结果没有结构化错误码。
2. repeat-tool-reminder 的纠错链只分类 `code === 'INVALID_ARGS'`，任何拒绝都进不了该链——且链按错误消息计数，交替的拒绝文本会互相重置计数。

## Decision

`@deepseek-ai/dsh-sandbox` 的共享升级词汇现在把调用方可修复的拒绝——两个参数配对违规、空 `justification`、非严格扩大目标——抛为携带稳定错误码 `SANDBOX_ESCALATION_INVALID` 的 `HarnessError`。模型可见文本不变；新增的只是错误的结构化身份。审批结果（拒绝、取消、不可用、缺服务或缺 agent）保持普通 `Error`：它们是对格式正确请求的策略裁决，不是调用方可修复缺陷，绝不能进入循环守卫。

`@deepseek-ai/dsh-repeat-tool-reminder` 把 `INVALID_ARGS` 与 `SANDBOX_ESCALATION_INVALID` 都分类为调用方可修复，并以 `(tool name, error code)` 作为纠错链的键。同一失败类的消息变体共同累计；通知引用最新一次失败的文本。成功或普通结果会把链重置回普通参数键链。

## Alternatives considered

**当会话生效模式已到最高档时隐藏升级字段。** 本次修复未采用：schema 是全局注册的，按会话投影 schema 是一次架构变更；沙箱 note 已明确接受静态目标集并以执行检查为边界。

**继续按 `(tool, code, message)` 计链。** 被生产证据否决：交替的 `danger-full-access`/`workspace-write` 拒绝产生两种消息，两条按消息计数的链都到不了连续三次失败——这正是观察到的十一次失败循环。

**自动丢弃无效 `sandbox_permissions` 参数并执行命令。** 未采用：把被拒绝的请求静默改写成放行执行会模糊沙箱 note 钉死的 fail-closed 边界；guard 的纠错通知让拒绝保持显式。

**把所有重复错误一律视为无效而不看错误码。** 未采用：abort 与 provider 故障是环境性的，不是调用方可修复；以它们触发停机会惩罚中断和损坏的后端。

## Verification

`packages/sandbox/sandbox/tests/escalation.spec.ts` 钉住非严格扩大与空 justification 拒绝的结构化错误码，并钉住审批拒绝不携带该码。repeat-tool-reminder 行为套件驱动真实 agent loop 跑交替目标的升级循环：恰好三次记录调用、每个结果都有 `SANDBOX_ESCALATION_INVALID` 元数据、一条引用最新拒绝的纠错通知、没有第四次模型工具调用、最终 `turn/end {kind: "blocked"}`。原有 `INVALID_ARGS` 套件（同一消息、变化参数）保持绿色，精确重复、重置与拒绝套件同样全部通过。

## Consequences

升级拒绝循环现在每 turn 最多消耗配置数量的尝试：拒绝 → 通知 → 阻止，最后一条失败仍然可见且可审计，用户消息以全新 guard 状态重启。模型可见的拒绝文本与之前逐字节一致，因此 recorded-session snapshot 文本无需变化；重复调用方可修复失败时的纠错通知是新的模型可见行为，由行为套件覆盖。

pwsh 与文件系统家族通过共享升级辅助函数继承修复，无需各自改动。过度请求仍可能发生（schema 仍暴露这些字段）；变化的是它产生的循环现在有界。
