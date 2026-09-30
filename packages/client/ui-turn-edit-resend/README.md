---
description: "The Web edit-and-resend entry on a settled user message and its inline edit card, over the turnResend Host Remote."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-turn-edit-resend

English | [中文](README.zh.md)

## Summary

This browser plugin adds an edit entry to a settled user message and an inline card above the composer. The entry reads the Host's `turnResend.check`, seeds the card with the turn's prompt text, and discloses the tools the turn called. Saving calls `turnResend.submit`; a failure keeps the card and its text. The card is the only browser half of the edit-and-resend Bundle, which `web` stacks by default.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## Use this package

The `web` profile stacks the `@deepseek-ai/dsh-session-turn-edit-resend` Bundle, whose patch mounts this browser row and the Host `turnResend` service. The row declares `dsh.client` and appears in the browser roster. It injects the slot registry, the `turnResend` Remote, and copy.

The entry registers into the `conversation.chat.user-actions` list on a user message. The card registers into `conversation.input.dock`, so it renders above the composer. Both share one Session-keyed store, so either can open, edit, and settle the same attempt across remounts.

Saving sends the edited text with the minted `operationId`. The Host answers a repeated identity from its journal, so the button never produces a second model request for one attempt.

<a id="understand-the-implementation"></a>
## Understand the implementation

### Entry and card

[`src/client/index.ts`](src/client/index.ts) creates the store and registers both seats. The entry calls `check(sessionId)` on click and stores the returned text, turn, range, and `toolCalls`. The card renders the tool disclosure when `toolCalls` is non-empty, submits through `submit(sessionId, { operationId, text }, signal)`, clears on `admitted`, and keeps the text with a failure line otherwise.

The visible conversation presents the replacement generation: [`ui-conversation`](../ui-conversation/README.md) hides the seqs a `user/message` surface replacement shadowed, so the edited turn shows in place of the old one while the Session log keeps every event.

<a id="model-experience"></a>
## Model Experience

### Edit and resend entry

#### What the model sees

Nothing directly. The entry and card are browser presentation; only `turnResend.submit` reaches the model, and the Host replaces the model-visible surface through `agent.followup`.

#### Token effect

Zero for the entry and card. The submitted edit replaces the shadowed turn in the next request through the Host.

#### KV Cache effect

Independent. The browser half changes no model request prefix.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Tool disclosure is advisory.** The card names the tools a resend may rerun, but it does not and cannot prove the repeat safe; the user owns that decision.
- **The entry targets the latest completed turn.** `check` selects that turn, so an entry clicked on an older message edits the latest eligible one; the Host re-selects under its idle claim, and a stale target is refused.
- **No optimistic transcript edit.** The card clears on `admitted`; the replacement reaches the transcript when its `user/message` event arrives, not before.

<a id="dev-note"></a>
### Dev Note

The [card tests](tests/edit-resend.client.spec.tsx) cover the tool disclosure, submission, and draft retention on failure.
