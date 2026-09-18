# Agent Note: Session-scoped escalation schemas

Status: implemented

English | [中文](2026-09-17-session-scoped-escalation-schema.zh.md)

## Problem

The sandbox tools advertised every escalation target whenever a confining backend was mounted. A session already at `danger-full-access` therefore still received `sandbox_permissions` and `justification`, encouraging a request that the strict-wider execution check must reject. Empty or whitespace-only `justification` values then failed before the command body, and message variants could consume repeated tool attempts.

## Decision

The global tool definition remains the complete fallback for agentless direct callers. Every published Agent receives a same-name scoped shadow whose parameters are derived from its effective session policy:

- `read-only`: `workspace-write` and `danger-full-access` remain available;
- `workspace-write`: only `danger-full-access` remains available;
- `danger-full-access` and unconstrained execution: neither escalation field is advertised.

A `sandbox/mode` event refreshes the Agent shadow before the next request. Omitted schema fields are presentation only: injected legacy or malformed arguments still reach the original execution closure and fail through `SANDBOX_ESCALATION_INVALID`. `validateEscalationArgs` remains the first tool-body check for a real escalation and rejects missing, orphaned, empty, or whitespace-only justification before shell or filesystem execution.

## Alternatives considered

**Keep a global target enum and rely only on prompt context.** Rejected because the model sees the schema as an actionable field set; a current-policy sentence does not remove the invalid option.

**Silently drop same-mode fields at execution.** Rejected because it hides malformed model calls and weakens the durable error/result record. The scoped schema prevents normal generation; execution remains fail-closed for injected fields.

**Move conditional pairing validation into the generic JSON schema.** Rejected because the parameter DSL has no trim-aware cross-property condition. The shared helper is the first executable check and carries the structured caller-fixable code.

## Verification

The sandbox vocabulary suite pins the real target set for every effective mode. The bash tools suite creates Agent-scoped shadows for `danger-full-access` and `workspace-write`, verifies schema omission/narrowing while retaining the global fallback, and verifies that an injected field reaches structured strict-wider rejection. Bash, pwsh, filesystem, sandbox, and repeat-tool-reminder suites run together; the four affected TypeScript projects typecheck. The Lite Swift test suite covers titlebar exclusion geometry and legacy session-data migration idempotence.

## Consequences

A model at the highest sandbox mode does not see an impossible escalation action. A model in a confined session sees only an actionable wider target. Request headers may begin a new model series when a user changes sandbox mode because the scoped tool schema legitimately changes; session logs retain the exact header that the model saw.
