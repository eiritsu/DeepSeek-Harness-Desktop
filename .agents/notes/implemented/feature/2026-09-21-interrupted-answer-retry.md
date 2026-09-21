# Agent Note: Retry an interrupted assistant answer

Status: implemented

English | [中文](2026-09-21-interrupted-answer-retry.zh.md)

## Problem

An interrupted assistant answer left a durable `assistant/message` with `interrupted: true` and nothing the reader could do about it: the Turn tail offered copy and branch only, and the sole "retry" in the product was the provider-failure retry policy. Resuming meant retyping the prompt or sending a literal "continue", which either duplicated the prompt or fed the half answer back as new input. Neither produces the model history a regenerate needs: one replay of the original prompt, no shadowed partial, and the current model, effort, and permission configuration.

## Decision

The Chat Turn tail renders a Retry icon beside copy when the latest Turn of an idle Session closes on a genuinely interrupted assistant answer whose Turn ran no tool call. The button admits `session/retryInterrupted` with that assistant message id and reports failure inline.

The Host command requires an idle Agent and resolves the target from the Session's current surface: the last surface node must be the addressed interrupted `assistant/message`, the latest closed Turn must own it, and within that Turn's surface range the resolver locates the replayable prompt — an ordinary `user/message` or a previous retry's `assistant-retry` — accepting only injected user-role context and system nodes between it and the interrupted answer. Tool calls or results, a second assistant answer, a second replayable prompt, or no replayable prompt reject with `session/retry-unavailable`.

On acceptance the Host mints a new `user/message` whose content is the prompt's durable content (text and attachment references) and whose source is the merge-extensible `assistant-retry` kind carrying `retryOf`. The Agent's one-shot `retryInterrupted(message, replacement)` capability stores a pending surface replacement and wakes the ordinary follow-up turn; the loop appends the first-attempt message with the replacement's `surfaceOp: { op: 'replace', startSeq, endSeq }` and complete `sourceEventSeqs` instead of an append. The new Turn therefore runs the ordinary pre-step, current request configuration, and streaming path, while derived history contains the replay exactly once and no interrupted partial. The append-only log keeps the replaced attempt for audit, and the replacement's provenance makes an interrupted retry retryable again.

The pending replacement is one-shot and never overwrites a live one: a rejected pre-step, a rewritten or emptied admitted batch, an admission throw, cancellation, and driver teardown all clear it. The Client keeps one admission per Session in flight, ignores a second click, and drops a settlement invalidated by a connection reset.

## Alternatives considered

**Send a literal "continue" or re-send the prompt through the composer.** Rejected: it appends a second user message, so the model sees the original prompt, the interrupted partial, and the new input. It also depends on the composer draft instead of the durable prompt.

**Append the replacement from the Host and wake with no admitted message.** Rejected: the loop closes a Turn whose first enter admits nothing, so the step would never run; a wake token that is appended normally duplicates the prompt.

**Replay the interrupted partial's content as the prompt.** Rejected: the partial is the answer, not the prompt; replaying it makes the model continue its own half sentence.

**Accept every interrupted answer and let the Host reject at click time.** Rejected: a button that always fails is worse than none; the resolver rejects the ambiguous shapes up front.

**Hide the button whenever the Client cannot prove the exact Host condition.** Partially rejected: the Client's Turn data proves the no-tool, single-answer, latest-Turn shape, and the runtime-context case the Host now accepts. The residual — an automatic goal round or an extra ordinary user input in the Turn — is not visible to the Turn-tail Definition, so that click reports `session/retry-unavailable` inline instead of hiding.

## Consequences

The action reuses the existing surface-replacement and provenance mechanism, so `SESSION_FORMAT_VERSION` is unchanged: the only new durable fact is a `user/message` replacement whose source is a merge-extensible `MessageSourceMap` entry. The Agent gains an optional `retryInterrupted` capability; a driver without it reports `session/retry-unavailable`. The current surface tail, not a numeric span, defines the replaced range, so an injected runtime-context node between the prompt and the answer is shadowed with them. A Turn that ran tools, produced more than one answer, or was opened by anything other than a replayable prompt cannot be retried.
