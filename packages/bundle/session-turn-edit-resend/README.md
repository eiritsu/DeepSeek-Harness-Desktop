---
description: "The bundle layer that adds edit-and-resend of the latest replaceable turn to a dsh --profile surface."
kind: "package-bundle"
---

# @deepseek-ai/dsh-session-turn-edit-resend

English | [中文](README.zh.md)

## Summary

This Bundle's Host service decides whether an Agent's latest replaceable turn may be edited, and replaces that turn's model-visible surface range with the edited prompt. Every attempt is recorded in the Session log under a caller-owned `operationId`, so a repeated submission is answered from the log instead of calling the model again. The original events stay in the append-only log. The Web profile stacks this Bundle: the browser half adds the edit entry and replaces that message with an in-place editor. A turn that ran tools stays editable, and the entry discloses the tools whose side effects a resend may repeat.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## Use this package

Mount the `session-turn-edit-resend` row alongside a live Agent service. The service is a `TypertRemoteService` under the `turnResend` Remote namespace. The `web` profile stacks this Bundle and mounts its browser row, `@deepseek-ai/dsh-client-ui-turn-edit-resend`, which offers the edit entry on the latest replaceable turn.

`check(agent)` reports whether the Agent's latest turn can be edited now: the prompt text a composer is seeded with, its turn, the first replaced seq, and the tool names the turn called. `submit(agent, request, signal)` replaces the turn. A refusal is either the activity blocker (`agent-busy`, `inbox-pending`, `aborted`) or a selection refusal (`no-replaceable-turn`, `not-latest-turn`, `no-human-prompt`, `no-editable-text`).

### When a turn is editable

The Agent must be idle with no pending input, and its latest turn must have ended in a state this feature may replace: the loop completed it, or the user cancelled it. A turn that errored, was blocked, was truncated at its token ceiling, or was closed as a crash-orphan or fork seed is not replaceable. `check` reads current state and promises nothing about a later `submit`, which selects the target again while it owns the Agent's idle phase.

A turn that ran tools stays editable, and its tool names ride `check`. The replacement shadows the turn's tool calls, their results, and its old answer in the model-visible surface, while the append-only log keeps every record. A resend asks the model to repeat those calls, so the browser entry confirms the repeat with the user before submitting; keeping the turn editable is the product decision, and the disclosure is the safeguard.

### Submitting an edit

`submit` is idempotent in `request.operationId`. A recorded identity returns its record, so a repeated submission never produces a second model request. The edited message reuses the original prompt's non-text content: attachment and image blocks, and any later text block a plugin derived from them, cross into the replacement unchanged.

<a id="understand-the-implementation"></a>
## Understand the implementation

### Selection

[`src/policy.ts`](src/policy.ts) reads the log alone. The target is the latest replaceable turn, and its surface span excludes the reserved system head, so a replacement can never shadow the system prompt. The replaced range starts at the direct human prompt and carries every later node of the turn.

### Durable operation journal

[`src/journal.ts`](src/journal.ts) folds three log-only events. `turn-resend/requested` records the caller's identity and target. `turn-resend/request-started` records that the resent message is durably queued, which is the point after which the model request is reachable. A successful resend has no further event: the resent message admitting to the surface under a `surfaceOp` replacement is its own proof, so an operation replays as `admitted` even when the process stopped before anything else could be written. An operation whose request started without that proof replays as `uncertain`, and the Harness never resolves uncertainty by repeating the call. A refusal is recorded as a `requested`/`settled` pair.

### Atomic admission and the flush barrier

`submit` holds the Agent's idle phase through `runMaintenance` across selection, the message append, and the two operation events; no turn can open and no other submission can enter between deciding and committing. It then flushes the Session before releasing the phase. The driver's wake is released by `runMaintenance` after the flush settles, so the model request cannot reach the provider before the durable `request-started` record exists.

<a id="model-experience"></a>
## Model Experience

### Turn edit and resend

#### What the model sees

`Session.deriveMessages()` returns the edited prompt where the shadowed turn stood; the original events remain in the log. The replacement starts a new request series, so the provider sees the edited turn as fresh context.

#### Token effect

The shadowed turn's prompt and answer leave the derived request; the edited prompt and its new answer enter it. The unchanged prefix before the replaced range remains eligible for provider cache reuse.

#### KV Cache effect

The unchanged prefix before the replaced range can reuse its cache. The replacement and everything after it are new tokens.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **External side effects may repeat.** A tool turn is editable, so a resend can re-run tools whose effects are outside the Harness. The browser entry discloses the tool names and asks for confirmation; the Harness does not rewind files, processes, or any other external state.
- **No cross-process coordination.** The idle-phase claim is process-local. Two Hosts sharing one Session store are not serialized.
- **Uncertain outcomes are terminal.** A recorded request that never admitted is never retried, even if the caller repeats the same `operationId`; the caller must submit a new identity to try again.
- **Flush participation is not asserted.** The barrier orders the model request after `sessions.flush`. A Session with no durability listener flushes vacuously, so only in-process append ordering protects the record.

<a id="dev-note"></a>
### Dev Note

The [Host tests](tests/host.host.spec.ts) cover eligibility, tool-turn refusal, atomic admission, the flush barrier, operation identity, restart replay, attachment preservation, and the replaced range. `src/types.ts` is the browser-facing contract outlet: it imports leaf modules only and merges no cordis `Context`, so the Client program reads this vocabulary without loading the Host `SessionStore` merge; [contract-face.spec.ts](tests/contract-face.spec.ts) holds that separation.
