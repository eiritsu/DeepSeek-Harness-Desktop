# Agent Note: The turn outline labels an edit-and-resend turn with its replayed prompt

Status: implemented

English | [中文](2026-09-22-turn-outline-resend-prompt.zh.md)

## Problem

[`turnOutline`](../../../../packages/session/session-turn-outline/README.md) filled a turn's `prompt` only from `user/message` events whose source kind is `user`. An edit-and-resend opens its turn with a replayed prompt whose source kind is `assistant-retry` and whose `surfaceOp` replaces the shadowed surface range, so the fold skipped that event: the entry kept `prompt: ''`, and the first later steering message of the turn filled the preview with text the turn did not open on.

The chat rail reads this outline wherever the loaded window supplies nothing — turns outside the window, and loaded turns whose nodes carry no prompt — so a resend turn presented another message's words exactly where the outline is the only source. In `session-3515b50e-c416-44ee-8dd3-3dd9781ddf61` the turn 41 entry read `但是这个会话中9月21日和9月22日的记录丢失了`, a steering message, instead of the replayed prompt `发现一个问题哈，我们这个会话是不是有记录丢失？`, while the Chat transcript and the loaded rail item both present that replayed prompt as the turn's opening user message.

## Decision

[`isOpeningPrompt()`](../../../../packages/session/session-turn-outline/src/projection.ts) accepts a `user/message` event as the newest turn's opening prompt when its source kind is `user`, or when its source kind is `assistant-retry` and the event carries a replacement `surfaceOp`.

Injected plugin context, compaction checkpoints, and a released retry's appended copy stay excluded, so navigation never offers a message the Chat transcript does not present as an opening user message. The remaining fold rules are unchanged: only the newest empty entry fills, the preview budgets stand, the draft identity gate keeps quiet, and turn order stays strictly increasing.

`assistant-retry` is declared by the session controller, which this package does not reference, so the classification compares the declared source string rather than the local union.

## Alternatives considered

**Accept every replacement `user/message`.** Compaction checkpoints are replacement user messages too, so the surface operation alone would hand the preview slot to model-facing checkpoint text; this repository recognizes checkpoints and resend copies through declared source kinds.

**Accept a released retry's appended copy as well.** The Chat transcript presents that copy as injected context, so the outline would advertise words the loaded rail never shows as that turn's opening message, and the two previews would disagree for one turn.

**Leave the preview to the loaded window.** The outline is the only source exactly where the defect shows — a turn outside the window, or a loaded turn whose nodes carry no prompt — so an empty or mislabelled entry stays visible there.

**Compare against the source union directly.** `MessageSourceMap` is merge-extensible and its `assistant-retry` member lives in a package this one does not reference, so the literal comparison does not typecheck in this package's compiler face.

## Verification

[`packages/session/session-turn-outline/tests/projection.spec.ts`](../../../../packages/session/session-turn-outline/tests/projection.spec.ts) replays the real event shape — an earlier turn with its own prompt, `turn/start`, the appended original prompt, the plugin notice, the aborted `turn/end`, a new `turn/start`, the replacement prompt carrying its `surfaceOp` and `sourceEventSeqs`, an `assistant/message`, and a later steering prompt — and pins all three outline entries: the resend turn carries the replayed prompt, and each earlier turn keeps its own prompt and response.

## Consequences

Navigation labels a resend turn with the prompt it opens on before that turn's events load and while it lies outside the loaded window, so the outline preview and the Chat transcript's opening user message agree.

No entry is removed or re-attributed: earlier turns keep their prompt and response previews, paged-back history stays reachable through the rail, and injected context, tool results, and compaction checkpoints still never reach navigation.
