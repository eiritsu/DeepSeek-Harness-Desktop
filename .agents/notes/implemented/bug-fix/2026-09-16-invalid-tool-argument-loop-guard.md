# Agent Note: Repeated invalid tool-call termination

Status: implemented

English | [中文](2026-09-16-invalid-tool-argument-loop-guard.zh.md)

## Problem

A model can ignore a valid tool schema and repeatedly submit calls that fail argument validation. Exact-call detection does not catch the loop when the model changes an irrelevant field between attempts. One observed `gemini-3.8-flash` turn submitted more than eighty `run_code` calls containing only `description`; every call failed with the same `INVALID_ARGS: missing required property "code"`, but different descriptions reset the exact-argument chain.

The tool registry must continue rejecting malformed input. It cannot infer executable code from a natural-language description, and treating an omitted program as success would falsely report work as performed. The agent loop nevertheless needs a finite recovery path when repeated deterministic validation failures prove that self-correction is not happening.

## Decision

The shipped `repeat-tool-reminder` keeps exact canonical arguments as the identity for successful calls and ordinary failures. An `INVALID_ARGS` result instead uses `(tool name, error code, error message)` as its chain identity, so changing other arguments does not hide the repeated validation failure.

By default the second matching failure appends one source-attributed correction notice that quotes the validation error and tells the model to re-read the schema. The notice explicitly states that a required `code` field contains executable program text and that `run_code` requires both `code` and `description`. A third matching failure is still logged as the tool's own error; the guard then rejects the next `agent/pre-step`, so the turn closes durably as `blocked` without another model request. A real user message clears both the repeat chain and the pending stop.

The reminder and stop counts are configurable as `invalidArgsReminderThreshold` and `invalidArgsStopThreshold`. The stop threshold must be an integer greater than the positive reminder threshold. Ordinary repeated calls remain advisory under the existing `thresholds` behavior.

**Chain identity is now the error code, not the error message** (extended by [the sandbox escalation integration](2026-09-17-sandbox-escalation-loop-guard.md)). A caller-fixable failure class — `INVALID_ARGS` or `SANDBOX_ESCALATION_INVALID` — accumulates as one chain regardless of message variants, because the escalation production loop showed that a model alternating two refusal texts resets every message-keyed chain forever. The quoted error text is the latest failure's message; a genuinely different failure class still forms its own chain, and any successful or ordinary result resets to the ordinary argument-keyed chain.

## Alternatives considered

**Make `run_code.description` optional or remove it.** Rejected because the observed model omitted `code`, not just `description`; reducing another field does not guarantee a program and weakens useful UI labels for models that follow the schema.

**Treat description-only calls as successful no-ops.** Rejected because a successful tool result would claim execution despite having no executable program, hiding incomplete work from both the model and the user.

**Generate code from the description inside the tool runtime.** Rejected because it would add an unreviewed model-to-code synthesis boundary inside a deterministic executor and could execute behavior the calling model never supplied.

**Use only a global step cap.** Rejected as the primary fix because it would terminate legitimate long tool workflows late and without explaining the concrete schema error. The failure-signature guard intervenes at the owning behavior and leaves unrelated turns unchanged.

## Verification

The repeat-tool-reminder behavior suite drives changing invalid argument objects through the real agent loop. It pins one correction notice after two failures, exactly three recorded calls, `INVALID_ARGS` metadata on every result, no fourth model tool call, and a final `turn/end {kind: "blocked"}`. Configuration tests reject invalid reminder and stop thresholds. Existing exact-repeat, per-agent, reset, denial, downstream-decision, and argument-preview tests remain green.

## Consequences

A deterministic argument-validation loop consumes at most the configured number of tool attempts instead of running until manual cancellation. The final tool failure remains visible and auditable, while the blocked turn makes the stop explicit. A new user instruction can retry with fresh guard state.

The guard is process-local and heuristic; resuming a session starts fresh counters. Caller-fixable failures of different error codes remain separate chains; message variants of one code share a chain. Providers that repeatedly produce malformed calls may still block individual turns, but they no longer create unbounded tool-result noise or token spend.
