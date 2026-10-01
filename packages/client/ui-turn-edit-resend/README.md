---
description: "The Web edit-and-resend entry on a settled user message and the in-place editor that takes its place, over the turnResend Host Remote."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-turn-edit-resend

English | [中文](README.zh.md)

## Summary

This browser plugin adds an edit entry to a settled user message and replaces that message with an in-place editor while the attempt is open. The entry reads the Host's `turnResend.check`, seeds the editor with the turn's prompt text, and discloses the tools the turn called. Saving calls `turnResend.submit`; a failure keeps the editor and its text, and a click the Host refuses states the reason in the same place. The plugin is the only browser half of the edit-and-resend Bundle, which `web` stacks by default.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## Use this package

The `web` profile stacks the `@deepseek-ai/dsh-session-turn-edit-resend` Bundle, whose patch mounts this browser row and the Host `turnResend` service. The row declares `dsh.client` and appears in the browser roster. It injects the slot registry, the `turnResend` Remote, copy, and the Chat body-claim service.

The entry registers into the `conversation.chat.user-actions` list on a user message. Opening an attempt claims that message's body through `ctx.uiChat.claimUserMessageBody(sessionId, seq, owner)`; the `conversation.chat.user-body` chain entry accepts the claim and renders the editor in place of the bubble, which stays mounted underneath. Releasing the claim returns the bubble. Both seats share one Session-keyed store, so either can open, edit, and settle the same attempt across remounts.

Saving sends the edited text with the minted `operationId`. The Host answers a repeated identity from its journal, so the button never produces a second model request for one attempt.

<a id="understand-the-implementation"></a>
## Understand the implementation

### Entry and in-place editor

[`src/client/index.ts`](src/client/index.ts) creates the store, claims and releases the body, and registers both seats. The entry calls `check(sessionId)` on click; an eligible answer stores the returned text, turn, range, and `toolCalls` and claims the clicked seq, while a refusal or a transport failure stores a notice for that seq. The editor renders the tool disclosure when `toolCalls` is non-empty, submits through `submit(sessionId, { operationId, text }, signal)`, clears on `admitted`, and keeps the text with a failure line otherwise; the notice form states the reason and offers only dismissal.

One claim owns a Session's message at a time: a newer claim replaces the older one, and the Chat registry turns the replaced claim's release into a no-op, so a stale editor can never unclaim its successor.

The visible conversation presents the replacement generation: [`ui-conversation`](../ui-conversation/README.md) hides the seqs a `user/message` surface replacement shadowed, so the edited turn shows in place of the old one while the Session log keeps every event.

<a id="model-experience"></a>
## Model Experience

### Edit and resend entry

#### What the model sees

Nothing directly. The entry and editor are browser presentation; only `turnResend.submit` reaches the model, and the Host replaces the model-visible surface through `agent.followup`.

#### Token effect

Zero for the entry and editor. The submitted edit replaces the shadowed turn in the next request through the Host.

#### KV Cache effect

Independent. The browser half changes no model request prefix.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

No runtime invariant companion is published because this plugin emits no independent event stream: the slot registry owns contribution lifecycles, while its Session-keyed draft and body claim are checked directly by interaction tests.

- **Tool disclosure is advisory.** The editor names the tools a resend may rerun, but it does not and cannot prove the repeat safe; the user owns that decision.
- **The entry appears on the latest turn only.** `check` selects the latest replaceable turn, so an older prompt shows no edit entry; the Host re-selects under its idle claim and refuses a stale target.
- **An open attempt is process-local.** The editor and its draft live in client memory, so a reload drops the attempt; the Session log already holds every durable record.
- **No optimistic transcript edit.** The editor closes on `admitted`; the replacement reaches the transcript when its `user/message` event arrives, not before.

<a id="dev-note"></a>
### Dev Note

The [editor tests](tests/turn-resend-body.client.spec.tsx) cover the tool disclosure, submission, notices, and draft retention on failure; the [entry tests](tests/turn-resend-action.client.spec.tsx) cover turn gating and the click's outcomes.
