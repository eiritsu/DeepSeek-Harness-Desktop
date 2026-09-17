---
description: "Advisory loop-hygiene guard that nudges the model out of identical tool-call loops, for users and maintainers choosing, configuring, or debugging the plugin."
kind: "package-reference"
---

# @deepseek-ai/dsh-repeat-tool-reminder

English | [中文](README.zh.md)

## Summary

This package helps a model escape tool-call loops. Exact repeated calls receive advisory reminders at configured counts. Repeated caller-fixable failures — `INVALID_ARGS` and `SANDBOX_ESCALATION_INVALID` — are keyed by tool and failure code even when their arguments or messages vary: the default injects a correction notice after two failures and blocks the current turn after three. Chains are tracked separately for each agent and cleared by a new user message. The `dsh` base bundle enables the package.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount this plugin when the model should catch itself looping on identical tool calls. There is nothing to learn or wire: the `dsh` base bundle already runs it, and the defaults work for most sessions — tune the thresholds and tool scope below when you want the nudge sooner, later, or on fewer tools.

### When to choose it

Choose it when the model works autonomously for long stretches and a stuck loop must not run unbounded. Valid exact repeats remain advisory. Schema-invalid calls are stricter because repeating the same validation failure cannot make progress: the guard provides one correction opportunity, then ends the turn. Near-identical successful calls are not detected because ordinary chains still require the same tool and canonical arguments.

### Setting the thresholds and scope

When you want to change when reminders fire or which tools they cover, mount the plugin with configuration:

```yaml
- name: '@deepseek-ai/dsh-repeat-tool-reminder'
  config:
    thresholds: [3, 5, 8]        # remind at 3, 5, and 8 consecutive repeats
    include: []                  # track every tool; list patterns to track only some
    exclude: [todo_write]        # never track these tools
    argumentsPreviewChars: 500   # cap on arguments shown in the detailed reminder
    invalidArgsReminderThreshold: 2 # correct repeated schema-invalid calls
    invalidArgsStopThreshold: 3     # block the turn after this many failures
```

| Field | Default | Meaning |
|---|---|---|
| `thresholds` | `[3, 5, 8]` | Repeat counts that trigger a reminder |
| `include` | `[]` | Only these tools are tracked; empty means every tool |
| `exclude` | `[]` | These tools are never tracked; calls to them neither count nor reset |
| `argumentsPreviewChars` | `500` | How many characters of the repeated arguments the detailed reminder shows |
| `invalidArgsReminderThreshold` | `2` | Same-code caller-fixable failure count that injects a correction notice |
| `invalidArgsStopThreshold` | `3` | Same-code caller-fixable failure count that blocks the next step; must exceed the reminder threshold |

Invalid configuration fails at startup with a clear error — an empty `thresholds` list, a repeat count below 2, a duplicate, a non-positive invalid-argument reminder threshold, or a stop threshold that does not exceed it — never a silent change of behavior. The generated [configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-repeat-tool-reminder) documents every accepted value.

### What you get

With the defaults, a model that repeats the same valid call receives a short reminder on the third repeat and detailed reminders on the fifth and eighth. Calls that fail with the same caller-fixable code receive a correction notice after the second failure even when the submitted arguments and error messages differ — an `INVALID_ARGS` violation and a `SANDBOX_ESCALATION_INVALID` refusal (such as escalating from an already-top `danger-full-access` session) both accumulate; a third failure causes the next step to reject and closes the turn as blocked. A new user message clears both states, so a fresh instruction can continue normally.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section explains how the guard detects repeats and delivers reminders, and points at the code that realizes it; the observable behavior is fully covered in [Use this package](#use-this-package).

### Design philosophy

The guard is built on four commitments:

- **Advisory for valid repeats, terminal for deterministic invalid loops.** Ordinary exact repeats only add context. Repeated caller-fixable failures (`INVALID_ARGS`, `SANDBOX_ESCALATION_INVALID`) receive correction context and then reject the next model step at the configured stop threshold.
- **Count in post-execute.** Detection runs on `tools/post-execute`, which also fires for denied calls; counting there lets one listener cover every attempt with no cross-event state.
- **Exact-match canonicalization.** Arguments reach the guard as the loop's `JSON.parse` output (or its raw-string fallback), so JSON's value domain is the whole input domain and a deep key-sort plus `JSON.stringify` is a complete, deterministic identity — no bigint, cycle, or `undefined` handling exists because no input path can produce them.
- **Fail loud at load.** Reminder, preview, and invalid-argument thresholds validate in `apply` and throw, never falling back to defaults.

### Detection: the repeat chain

Each agent has one chain. Successful and ordinary failed calls key it by `(tool name, canonical arguments)`, with property order ignored. Caller-fixable failures instead key it by `(tool name, error code)`: the code is the identity, so neither an irrelevant description nor a different variant of the same refusal — an escalation target flipped between `danger-full-access` and `workspace-write` — can reset the count. The quoted error text is the latest result's message. A different tracked identity resets the count to 1. The chain lives in a `WeakMap<Agent, Chain>`.

- **Untracked calls are transparent to the chain.** A call excluded by `include`/`exclude` neither increments nor resets the counter, so `grep X → todo_write → grep X` still counts as two consecutive `grep X` when `todo_write` is excluded — bookkeeping tools interleaved into a loop do not launder it.
- **Denied calls count.** Detection sits on `tools/post-execute`, which also runs for calls a `tools/pre-execute` listener denied; a model hammering a denied call is exactly the loop worth breaking.
- **Calls without an agent are ignored.** A direct `ctx.tools.execute()` caller has no model to remind and no live agent object to key on.
- **Per-agent keying, reset on user prompts.** One agent's repetition never trips another's reminder; a user prompt (`agent/pre-step`) deletes the submitting agent's chain, and object lifetime bounds the weak entry without a disposal listener.
- **In-memory only.** A session resumed from persistence starts with a fresh chain — the guard is a heuristic nudge, not a logged invariant, so reminders after a resume are the accepted cost.

### Reminder delivery

Reminders ride the post-execute decision's `additionalContexts` (source `{kind: 'plugin', plugin: 'repeat-tool-reminder', form: 'notice', summary: '<tool> × <count>'}` or `'<tool> invalid × <count>'`), never a `content` replacement: the `tool/result` event stays the tool's own output for audit. The loop buffers the context and appends it as an injected `user/message` after the step's tool results, which the session renders as a plain synthetic user message — model-visible, source-attributed, and reconstructable from the session log with no new session event. The post-execute listener always delegates via `next()` and prepends its reminder to the downstream context array. When an invalid-argument chain reaches its stop threshold, the following `agent/pre-step` rejects before another model request; the loop records `turn/end {kind: 'blocked'}`. A real user message clears the pending stop before delegating.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry: `Config` schema, fail-loud validation, chain listeners |
| — | No runtime invariant companion is published; the repeat chain is private to one post-execute listener and exposes no package-owned event or snapshot that an independent companion can observe. |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the package-level contract is not enough. They move from the tools waterfall to exhaustive configuration and the guard group map.

- [Tools subsystem reference](../../../docs/subsystems/tools.md) — the `tools/execute` waterfall, `additionalContexts`, and decision shapes this guard consumes.
- [Generated configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-repeat-tool-reminder) — every accepted config field and its source declaration.
- [guard group map](../README.md) — the sibling guard packages and the loop-hygiene family.

-----

<a id="model-experience"></a>
## Model Experience

### First-threshold context message

#### What the model sees

At the first configured consecutive-repeat threshold, that agent receives the reminder below. No tool schema or normal-call text is added.

##### First-threshold reminder

```markdown
You are repeating the exact same tool call with identical arguments. Carefully analyze the previous result before calling again: if the task is not complete, try a different approach or different arguments instead of repeating the call.
```

#### Token effect

Zero tokens before the threshold. The reminder is retained history for that agent.

#### KV Cache effect

Append-only; newly visible content follows the reusable request prefix and does not invalidate existing KV-cache entries.

### Later-threshold context message

#### What the model sees

A later threshold receives the detailed reminder template below. A capped argument preview ends exactly `… (+<omitted> more chars)`.

##### Later-threshold reminder

```markdown
Repeated tool call detected:
- tool: <toolName>
- consecutive_calls: <count>
- arguments: <canonicalArguments>
The repeated calls are not making progress. Do not call this tool with these exact arguments again. Inspect the latest result and choose a different action, different arguments, or finish the task if enough evidence has been gathered.
```

#### Token effect

Each reminder is retained history; `argumentsPreviewChars` bounds its data-dependent argument text, while agents keep independent counters.

#### KV Cache effect

Append-only; newly visible content follows the reusable request prefix and does not invalidate existing KV-cache entries.

### Invalid-call correction and stop

#### What the model sees

After the default second consecutive caller-fixable failure (`INVALID_ARGS` or `SANDBOX_ESCALATION_INVALID`) with the same tool and error code, the agent receives:

##### Invalid-call correction notice

```markdown
Tool argument validation failed repeatedly:
- tool: <toolName>
- consecutive_failures: 2
- error: <latestErrorMessage>
Do not repeat another variant of the same invalid call. Re-read the tool schema and the current runtime policy, and either fix the request or drop the invalid fields entirely. For a required code field, put executable program text in code rather than prose in description; run_code requires both, for example: {"code":"return await tools.name({})","description":"Run named tool"}.
```

#### Token effect

One bounded correction message is retained. A third same-code failure is recorded normally, then the next model step is rejected and the turn ends as blocked; no further model request is sent after the stop threshold. A later real user message starts with fresh guard state.

#### KV Cache effect

The correction is append-only. Stopping the turn avoids the repeated invalid requests that would otherwise keep extending the prefix.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define when the guard is a poor fit. They are current package constraints, not a task backlog.

- **Exact-match detection for non-schema failures** — canonicalization is a deep key-sort, so near-identical valid calls or other failures can evade the chain. Caller-fixable codes (`INVALID_ARGS`, `SANDBOX_ESCALATION_INVALID`) are the deliberate exception and key on the stable error code.
- **Compaction does not reset chains** — a chain spanning a compaction checkpoint keeps counting.
- **No subagent chain-sharing** — chains stay isolated per agent; a parent and its subagent repeating the same call never combine.
- **Legitimate idempotent polling still draws nudges** past the thresholds — the pressure valves are the `thresholds`/`exclude` config.
- **Past the highest threshold a chain goes silent** — reminders fire only at exact configured counts, never beyond them.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This Dev Note is working context for maintainers: open questions and directions that are not decided. It is explicitly non-authoritative — shipped behavior, limits, and accepted rationale live in the sections above, the package code, and the linked Agent Notes.

The [invalid-argument loop guard decision](../../../.agents/notes/implemented/bug-fix/2026-09-16-invalid-tool-argument-loop-guard.md) owns failure-signature correction and termination. The [repeat-tool-guard feature note](../../../.agents/notes/archived/feature/2026-07-08-repeat-tool-guard.md) records the original design and alternatives under the former package name; the [naming ledger](../../../.agents/notes/archived/architecture/2026-08-11-repository-naming-contract-and-rename-ledger.md) records the rename to `repeat-tool-reminder` and its reason.

</details>
