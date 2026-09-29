# Agent Note: Edit and resend a completed turn

Status: implemented

English | [中文](2026-09-29-turn-edit-resend.zh.md)

## Problem

Correcting a sent prompt meant forking the Session, even when the user wanted to keep working in the same one. The earlier removal of an unbacked Edit control withheld the affordance until a Host operation existed. Reusing model-surface replacement alone was not enough: a resend must also remove the old generation from the visible Chat, keep the append-only log, survive restart without repeating a model call, and keep the original prompt's attachments. A turn that ran tools is the hardest case, because a resend can ask the model to repeat an external side effect that no log record can undo.

## Decision

`agent.followup(message, replacement)` admits a user message in place of a surface range. The replacement carries `surfaceOp: { op: 'replace', startSeq, endSeq }` and `sourceEventSeqs` naming every shadowed surface node. `Session.deriveMessages()` returns the replacement where the range stood; the log keeps both records. The inbox records the range in the same `agent/inbox/spliced` commit that queues the message, so a restart before the driver claims it still admits the replacement.

The `@deepseek-ai/dsh-session-turn-edit-resend` Bundle's Host service `turnResend` owns one attempt. `check` reads eligibility from the log; `submit` re-selects under `agent.runMaintenance`, which holds the idle phase across selection, append, and the two operation events. It is idempotent in the caller's `operationId`: a recorded identity returns its record, so a repeated submission never calls the model twice. `turn-resend/requested` records the intent, `turn-resend/request-started` records the durable queue point, and a thrown admission records `turn-resend/settled: failed`. A successful resend has no further event: the admitting `user/message` replacement is its own proof, so a request that started without one replays as `uncertain` and is never retried. The service flushes the Session before `runMaintenance` releases the driver's wake, so the model request cannot precede the durable record.

A turn that ran tools stays editable. Its tool names ride `check.toolCalls`; the replacement shadows the turn's tool calls, their results, and its answer in the model-visible surface while the log keeps them. The browser half confirms the repeat with the user instead of refusing the turn.

The `@deepseek-ai/dsh-client-ui-turn-edit-resend` browser package adds an edit entry to a settled user message and an inline card above the composer. It calls `ctx.remote.turnResend`, renders the tool disclosure, submits the edited text, and maps each recorded outcome honestly: `admitted` clears the card, `uncertain` states that the result is unknown and offers no repeat, and `refused`/`failed`/`pending` state what the log proves. The `web` profile stacks the Bundle, whose patch mounts the Host service and the browser row. `ui-conversation` hides the seqs a replacement shadowed, so the visible transcript shows the replacement generation.

## Alternatives considered

**Refuse tool turns.** Rejected: the product wants the correction path even when tools ran, and a disclosure the user can decline is more useful than a dead affordance.

**Mutate or delete the original events.** Rejected: persistence, replay, diagnostics, and lossless export depend on the append-only log.

**Retry an uncertain operation.** Rejected: the log cannot prove whether the model was called, so a retry could duplicate an irreversible request.

**Reuse the queue editor.** Rejected: a queued message has not entered model history, while a completed turn has already been consumed.

## Consequences

- One edit appends a new turn plus the inbox range record; the replaced generation stays in the log and is hidden only in the visible conversation.
- The unchanged prefix before the replaced range keeps its provider KV-cache eligibility; the replacement starts a new request series.
- Restart reads the operation from the log: an admitted attempt is never re-sent, and an uncertain one is reported as unknown.
- Repeating external side effects remains possible; the browser entry discloses the tools and the Host does not rewind them.
- The idle-phase claim is process-local, so two Hosts sharing one Session store are not serialized.
