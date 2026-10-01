# Agent Note: Exact route reasoning selection

Status: implemented

English | [中文](2026-10-01-exact-route-reasoning-selection.zh.md)

## Problem

The harness-wide reasoning ladder made every model selector render the same rows whatever the resolved route reported. The Session's model selector therefore advertised efforts the route behind it could not encode, and it offered the control even for a model whose resolved metadata declares no efforts at all. Choosing a row was the only way to find out that the request would fail, and a menu listing a level a route never declared does not describe the route that will encode the request.

The levels a route accepts are facts about that route, not about the model. A model-specific channel catalog declares no MiniMax M3.1 route levels, so a deployment serving that model declares the levels itself on the exact route it configured. The ladder had removed the need for a deployment to declare anything, and with it the reason for a menu that does not match the route.

## Decision

**The Session selector describes the exact resolved route and model.** The Session model catalog copies `LlmResolvedModelInfo.reasoning.efforts` in adapter order and preserves the exact default effort the route reports. When the resolved model info carries no reasoning metadata, the catalog omits the reasoning field and the selector renders no effort control. This corrects the selector half of [One shared model catalog and one reasoning ladder](../feature/2026-09-29-shared-model-catalog-and-reasoning-ladder.md); the shared model catalog facts and the request-time refusal stay as that note records them.

**No downgrading.** The selector never substitutes a neighbouring effort for one the route does not declare, and `LlmRuntime` still refuses a stale or forged explicit effort the route does not support with `UNSUPPORTED_REASONING_EFFORT`, recorded as that turn's error. A selection stored before a route changed what it declares therefore fails with a named reason instead of being answered under a level nobody chose.

**A deployment declares the levels its exact route accepts.** A model-specific channel catalog does not declare MiniMax M3.1 route levels, so a deployment serving that model declares those efforts on its exact profile route, taken from the authoritative provider documentation. A sibling coding-plan channel is not evidence about another route: matching effort names across channels would encode a level that route never declared, which is the silent substitution the ladder was meant to remove.

## Alternatives considered

**Keep the uniform rows and let the request refuse.** A menu offering efforts the route cannot encode turns a configuration fact into a per-turn failure, and the only way to learn what a route accepts is to fail one.

**Downgrade to the nearest effort the route declares.** A silent substitution is the one outcome a person cannot detect: the turn succeeds, the transcript reads normally, and the answer was produced under a level nobody chose.

**Infer a route's levels from its sibling coding-plan channel.** Two channels serving the same model are separate routes with separate vocabularies, so a shared effort name is not a shared encoding.

**Render no control only for a model the catalog has never heard of.** Absence of reasoning metadata, not model identity, is the condition: a cataloged model on a route that declares no efforts has nothing to list either.

## Consequences

- The Session selector lists exactly the efforts the resolved route and model report, in adapter order, and preserves the exact default the route reports.
- A model whose resolved metadata declares no efforts renders no effort rows, so the absence is visible instead of being filled in by the harness.
- A stored explicit effort the exact route no longer lists is named unsupported rather than presented as the level in use; the effort pane's Default action clears it through the selection call, and rendering alone never rewrites the stored selection.
- A deployment that wants a control for a route serving MiniMax M3.1 declares the efforts on that exact profile route from the authoritative provider documentation; nothing infers them from a sibling coding-plan channel.
- An effort the route does not accept still fails one turn with `UNSUPPORTED_REASONING_EFFORT`, so a selection stored under an earlier configuration keeps its named error instead of being answered under another level.
- Adding a level to the harness ladder changes nothing a person sees in this selector, so the ladder and the selector can no longer drift apart silently.

## Testing

Focused tests cover a route that declares efforts (the catalog lists them in adapter order and preserves the route's exact default), a route with no reasoning metadata (the catalog omits the reasoning field and the selector renders no control), an unsupported explicit effort (the request fails with `UNSUPPORTED_REASONING_EFFORT` and substitutes nothing), and an effort declared on a different route (never copied into the catalog this selector reads). Component tests cover a stored effort outside the route's exact subset and one with no metadata at all: the selector names it unsupported, lists only the route's own levels (or just Default), keeps the stored selection until Default is chosen, and clears it through the selection call. A keyless recorded-session snapshot covers the selector with a declared effort list and without one, so the rendered rows are part of expected output. No real-API test is required: the change reads metadata the adapters already resolve.
