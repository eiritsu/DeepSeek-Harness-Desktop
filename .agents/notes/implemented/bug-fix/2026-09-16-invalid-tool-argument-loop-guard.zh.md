# Agent Note: 重复无效工具调用终止

Status: implemented

[English](2026-09-16-invalid-tool-argument-loop-guard.md) | 中文

## Problem

模型可能忽略有效的工具 schema，并反复提交参数校验失败的调用。当模型每次修改一个无关字段时，按精确调用检测无法识别该循环。实际观察到一次 `gemini-3.8-flash` turn 连续提交八十多次只有 `description` 的 `run_code` 调用；每次都以同一 `INVALID_ARGS: missing required property "code"` 失败，但变化的 description 重置了精确参数链。

工具 registry 必须继续拒绝畸形输入。它不能从自然语言描述推断可执行代码，把缺失程序当作成功也会错误报告工作已完成。但当重复的确定性校验失败证明模型没有自我纠正时，agent loop 需要有限的恢复路径。

## Decision

随附的 `repeat-tool-reminder` 对成功调用和普通失败继续使用规范化精确参数作为身份。对于 `INVALID_ARGS` 结果，则改用 `(tool name, error code, error message)` 作为链身份，因此修改其他参数无法隐藏重复的校验失败。

默认第二次匹配失败会追加一条带来源的纠错通知，引用校验错误并要求模型重新阅读 schema。通知明确说明必填 `code` 字段必须包含可执行程序文本，且 `run_code` 同时要求 `code` 和 `description`。第三次匹配失败仍按工具自身错误记录；随后 guard 拒绝下一次 `agent/pre-step`，因此 turn 持久化为 `blocked` 并且不会再发出模型请求。真实用户消息会同时清除重复链和待停止状态。

提醒次数和停止次数分别由 `invalidArgsReminderThreshold` 与 `invalidArgsStopThreshold` 配置。停止阈值必须是大于正整数提醒阈值的整数。普通重复调用仍遵循现有 `thresholds` 的建议性行为。

## Alternatives considered

**把 `run_code.description` 改为可选或移除。** 未采用，因为观察到模型缺少的是 `code`，不只是 `description`；减少另一个字段不能保证提供程序，还会削弱遵循 schema 的模型所提供的 UI 标签。

**把只有 description 的调用当作成功空操作。** 未采用，因为成功结果会在没有可执行程序时声称已经执行，向模型和用户隐藏未完成的工作。

**在工具 runtime 内根据 description 生成代码。** 未采用，因为这会在确定性执行器内部增加未经审查的模型到代码生成边界，并可能执行调用模型从未提供的行为。

**只使用全局 step 上限。** 未作为主要方案，因为它会较晚终止合法的长工具流程，也不能解释具体 schema 错误。失败签名 guard 在行为所有者处介入，不改变无关 turn。

## Verification

repeat-tool-reminder 行为测试通过真实 agent loop 驱动参数持续变化的无效调用。测试固定第二次失败后只有一条纠错通知、只记录三次调用、每个结果都携带 `INVALID_ARGS` metadata、不会出现第四次模型工具调用，以及最终 `turn/end {kind: "blocked"}`。配置测试拒绝无效提醒与停止阈值。现有精确重复、按 agent 隔离、用户重置、拒绝调用、下游决策和参数预览测试继续通过。

## Consequences

确定性的参数校验循环最多消耗所配置数量的工具尝试，不再持续到人工取消。最后一条工具错误仍然可见且可审计，blocked turn 明确记录停止原因。新的用户指令可以使用全新 guard 状态重试。

该 guard 是进程本地的启发式状态；恢复会话时计数重新开始。两个真正不同的校验消息仍是不同链。持续生成畸形调用的 provider 仍可能阻塞单个 turn，但不会再制造无界工具结果噪声和 token 消耗。
