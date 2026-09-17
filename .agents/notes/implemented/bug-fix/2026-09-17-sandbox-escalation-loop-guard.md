# Agent Note: Sandbox escalation refusal loop guard

Status: implemented

English | [中文](2026-09-17-sandbox-escalation-loop-guard.zh.md)

## Problem

A session whose effective sandbox mode is already `danger-full-access` still sees the escalation fields in the `bash`/`pwsh`/filesystem tool schemas (schemas are registry-global; the strict-widening check at execution is the safety boundary — [the sandbox note](../feature/2026-07-06-sandbox.md) accepts the over-ask). The production loop this fix closes: the model repeatedly requested `sandbox_permissions` with alternating targets (`danger-full-access`, then `workspace-write`), every call failed pre-execution with the same refusal, eleven failures accumulated across eight minutes, and the only interruption was one advisory reminder.

Two source-level facts enabled the loop:

1. The escalation refusals threw plain `Error`s. The tool registry only extracts `{name, code}` from `HarnessError` subclasses, so the results carried no structured error code.
2. The repeat-tool-reminder's corrective chain classified only `code === 'INVALID_ARGS'`, so no refusal ever entered it — and the chain keyed on the error message, so alternating refusal texts reset each other's counters anyway.

## Decision

The shared escalation vocabulary in `@deepseek-ai/dsh-sandbox` now throws its caller-fixable refusals — the two argument-pairing violations, a blank `justification`, and the non-widening target — as `HarnessError` with the stable code `SANDBOX_ESCALATION_INVALID`. The model-visible text is unchanged; only the error's structured identity is new. Approval outcomes (rejection, cancellation, unavailability, missing service or agent) stay plain `Error`s: they are policy decisions about a well-formed request, not caller-fixable defects, and must never feed a loop guard.

`@deepseek-ai/dsh-repeat-tool-reminder` classifies both `INVALID_ARGS` and `SANDBOX_ESCALATION_INVALID` as caller-fixable and keys the corrective chain on `(tool name, error code)`. Message variants of one failure class accumulate; the notice quotes the latest failure's text. A successful or ordinary result resets to the ordinary argument-keyed chain.

## Alternatives considered

**Suppress the escalation fields when the session's effective mode is at the top.** Rejected for this fix: schemas are registry-global and per-session schema projection is an architecture change; the sandbox note explicitly accepts the static target set with the execution check as the boundary.

**Key the chain on `(tool, code, message)` as before.** Rejected by the production evidence: alternating `danger-full-access`/`workspace-write` refusals produce two messages, so two message-keyed chains never reached three consecutive failures on either — exactly the observed eleven-failure loop.

**Auto-drop invalid `sandbox_permissions` arguments and run the command.** Rejected: silently rewriting a denied request into an allowed execution blurs the fail-closed boundary the sandbox note pins; the guard's corrective notice keeps the refusal explicit.

**Treat every repeated error as invalid regardless of code.** Rejected: abort and provider failures are environmental, not caller-fixable; keying the stop on them would punish interruptions and broken backends.

## Verification

`packages/sandbox/sandbox/tests/escalation.spec.ts` pins the structured code on the non-widening and blank-justification refusals and pins that an approval rejection stays uncoded. The repeat-tool-reminder behavior suite drives an alternating-target escalation loop through the real agent loop: exactly three recorded calls, `SANDBOX_ESCALATION_INVALID` metadata on every result, one correction notice quoting the latest refusal, no fourth model tool call, and a final `turn/end {kind: "blocked"}`. The original `INVALID_ARGS` suite (same message, changing arguments) remains green, as do the exact-repeat, reset, and denial suites.

## Consequences

An escalation-refusal loop now consumes at most the configured number of attempts per turn: refusal → notice → block, with the final failure still visible and auditable and a user message restarting with fresh guard state. The model-visible refusal text is byte-identical to before, so no recorded-session snapshot text changes; the correction notice for repeated caller-fixable failures is new model-visible behavior covered by the behavior suite.

The pwsh and filesystem families inherit the fix through the shared escalation helper without their own changes. Over-asking remains possible (the schema still advertises the fields); what changed is that the loop it produces is now finite.
