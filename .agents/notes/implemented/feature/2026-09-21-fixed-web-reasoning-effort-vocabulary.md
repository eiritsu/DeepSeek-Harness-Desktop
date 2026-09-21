# Agent Note: Fixed Web reasoning-effort vocabulary and Default semantics

Status: implemented

English | [中文](2026-09-21-fixed-web-reasoning-effort-vocabulary.zh.md)

## Problem

The Web composer's model seat and the `/model` popup derived their reasoning-effort choices from the exact model's adapter metadata (`reasoning.efforts`). A model advertising a nonstandard vocabulary (for example `standard` or `off`) showed only those names, a model without reasoning metadata showed no Effort row at all, and both entries wrote the metadata `defaultEffort` into a selection the user never chose. The same control therefore presented different levels across models and could submit a metadata default instead of the omission that lets the provider choose.

## Decision

Both Web entries offer the same fixed seven levels for every model, in order: Default, Minimal, Low, Medium, High, XHigh, and Max. The wire identifiers are the adapter-owned ids `minimal`, `low`, `medium`, `high`, `xhigh`, and `max`; Default is the absence of `reasoningEffort`. Adapter metadata never changes the list — advertised effort names and the declared `defaultEffort` are ignored, and a model without reasoning metadata still shows all seven levels.

Default is the selection whenever the durable state carries no `reasoningEffort`; it is never substituted with the model's metadata `defaultEffort`. A model switch in either entry submits only the provider and model, so it never writes a catalog default into the selection; re-picking the current route preserves its already-explicit effort. The menu checks the explicit effort, or Default when none is set.

The Host is the only validator. The Web layer does not intersect the fixed vocabulary with the adapter's advertised levels; it submits the picked identifier, and a value the Host rejects reports through the submitting entry's existing failure surface — the composer's transient toast or the popup's own error. The identifiers stay adapter-owned wire values; the model-facing subagent route discovery continues to resolve the adapter's advertised efforts ([model-selected subagent routes](2026-08-18-model-selected-subagent-routes.md)).

## Alternatives considered

**Keep the adapter-advertised levels and metadata default (status quo).** Rejected: exact-model vocabularies diverged, a metadata-less model lost the Effort row entirely, and the metadata default reached the selection without a user gesture.

**Intersect the fixed vocabulary with the adapter's advertised levels.** Rejected: the advertised list is advisory and may be narrower than what the route accepts, so intersecting would hide a level the Host would accept and reintroduce per-model variation. The Host validates the explicit choice.

**Filter or clamp unsupported levels in the client.** Rejected: silently altering a user's pick hides the outcome; rejection belongs to the Host and the existing failure surface reports it.

## Consequences

The Web control has one predictable vocabulary: the seven labels are pinned in the package dictionary, the Effort row is always present, and the menu state follows `reasoningEffort` alone. An adapter advertising a nonstandard name (for example `standard`) loses its custom Web label while the wire value stays adapter-owned. A durable selection now carries `reasoningEffort` only when the user picked it or the Host default set it, so a metadata `defaultEffort` no longer changes requests. An unsupported pick fails at the Host and surfaces as an error instead of disappearing from the list. The package README records the same user-visible contract.
