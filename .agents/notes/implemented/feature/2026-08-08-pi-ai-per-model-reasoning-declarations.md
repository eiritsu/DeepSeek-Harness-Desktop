# Agent Note: Per-Model Reasoning Declarations in llm-pi-ai

Status: implemented

English | [中文](2026-08-08-pi-ai-per-model-reasoning-declarations.zh.md)

## Problem

Private gateways can rename reasoning values and use a protocol dialect pi-ai cannot infer from their URL. A route-level `reasoning` value selects a default but cannot describe per-model wire spellings, and replacing an installed catalog model solely to correct one spelling would otherwise require restating the complete route catalog.

Two adjacent gaps compounded this. pi-ai decides the reasoning *wire dialect* (`compat.thinkingFormat`, `compat.supportsReasoningEffort`) by recognizing the endpoint URL, and a private gateway's URL says nothing — a DeepSeek-dialect gateway was spoken to in the OpenAI dialect with no configuration that could correct it. And the only way to touch one catalog model was the `models` list, which *replaces* the served catalog: narrowing `gpt-5`'s levels meant restating all thirty-eight openai models or silently dropping thirty-seven.

## Decision

`PiAiModelProfile` carries `reasoningEfforts`: each key is a pi-ai level and its value is the spelling dispatch sends on the wire. The declaration translates to pi-ai's `Model.reasoning` + `thinkingLevelMap`; explicit standard session levels retain configured spellings, while an undeclared `max` is attempted with the canonical `max` value. `off` is the one three-state key: absent or valueless leaves protocol-specific disable behavior to pi-ai, while a value is sent on the wire. `false` preserves a non-reasoning descriptor for Default calls; an empty declaration is refused. The spelling for "disable" is `false` rather than `{}` because schemastery materializes an absent dict as `{}` — only a `z.union([z.const(false), dict])` keeps absent, disabled, and declared distinguishable, and a bare `reasoningEfforts:` (YAML null) slips through that union unvalidated, so resolution refuses it explicitly. The fixed Composer choices are owned separately by [[2026-08-25-standard-reasoning-effort-controls]].

`compat.thinkingFormat` and `compat.supportsReasoningEffort` become configurable at two levels — route (its models' default) and model (winning per field) — resolving model → route → installed catalog entry → pi-ai's URL guess. `thinkingFormat` is pinned to pi-ai's union through a `Record<UpstreamUnion, true>` drift gate, so a pi-ai upgrade that adds a format fails compilation until the new member is classified (verified against the published 0.84.1 tarball, whose `thinkingFormat` union adds `baseten` over the pinned 0.82.1). Which fields `compat` carries, which protocols take each of them, and how an unreadable key is refused are owned by [[2026-08-18-pi-ai-wire-compat-surface]]; the two-level resolution order above is what that surface generalizes.

`modelOverrides` reshapes individual catalog models without replacing the served set: key = catalog model id, value = a `models` entry minus `id`, materialized by handing the override to the existing entry path so capacities, efforts, compat, and request-default semantics stay identical. Unlike Pi's own config layer, which ignores unknown ids, every override that lands nowhere is refused — beside a `models` list, on a hand-declared route, naming an unknown model, or smuggling an `id` in the value (the schema passes unknown keys through, and a smuggled id would quietly rename the model).

## Alternatives considered

- **Pass `reasoning` + `thinkingLevelMap` through verbatim** (pi-ai's own radius-config shape). Rejected by the user for operator confusion: the map's `null`-marks-unsupported convention plus the asymmetric absent-key rule mean the config's meaning depends on knowledge of pi-ai internals; the chosen shape makes the key set itself the offer.
- **A bare level list** (`reasoningEfforts: [off, high]`). Cannot express wire renames, and the catalog's own maps prove renames are real: 66 of 1230 installed map entries are non-identity (`off→none`, `minimal→low`, `low→LOW`, `high→default`).
- **`{}` as the disable spelling.** Unimplementable: schemastery materializes an absent dict as `{}`, so every model without the field would have been force-disabled.
- **Folding this into the route-level `reasoning` knob.** That knob is a default selection, not a wire mapping; it stays independent from per-model spellings.
- **Deriving wire spellings from a cloud capability catalog.** Rejected because a public catalog cannot know a private gateway's protocol dialect or aliases, and generated values would become indistinguishable from operator policy.

## Consequences

- Private gateways can translate standard reasoning selections without a provider-specific frontend or settings tab.
- `reasoningEfforts` does not hide or add Composer choices; unsupported selections reach the provider and may fail there.
- There is deliberately no spelling for returning one map key or compat field to "whatever the catalog said": the declaration is the whole offer, so keeping a catalog value means restating it. The README documents this.
- `verify-package-invariants` is untouched: the feature adds configuration resolution, no new events or mutable runtime relations.
