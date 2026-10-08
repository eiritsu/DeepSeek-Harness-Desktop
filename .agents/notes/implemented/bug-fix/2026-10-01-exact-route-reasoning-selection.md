# Agent Note: Exact route reasoning selection

Status: implemented

English | [中文](2026-10-01-exact-route-reasoning-selection.zh.md)

## Problem

The harness-wide reasoning ladder made every model selector render the same rows whatever the resolved route reported. The Session's model selector therefore advertised efforts the route behind it could not encode, and it offered the control even for a model whose resolved metadata declares no efforts at all. Choosing a row was the only way to find out that the request would fail, and a menu listing a level a route never declared does not describe the route that will encode the request.

Reasoning controls are facts about the serving endpoint. The current catalog declares MiniMax M3.1 efforts under its coding-plan provider, and the published coding-plan API endpoint is shared with the provider endpoint used by custom routes. A custom route may use that declaration only when its normalized API endpoint matches and the matching declarations agree; the sibling provider name alone does not supply evidence. A toggle remains a binary control and does not become an effort ladder.

## Decision

**The Session selector describes the exact resolved route and model.** The Session model catalog copies `LlmResolvedModelInfo.reasoning.efforts` in adapter order and preserves the exact default effort the route reports. When the resolved model info carries no reasoning metadata, the catalog omits the reasoning field and the selector renders no effort control. This corrects the selector half of [One shared model catalog and one reasoning ladder](../feature/2026-09-29-shared-model-catalog-and-reasoning-ladder.md); the shared model catalog facts and the request-time refusal stay as that note records them.

**No downgrading.** The selector never substitutes a neighbouring effort for one the route does not declare, and `LlmRuntime` still refuses a stale or forged explicit effort the route does not support with `UNSUPPORTED_REASONING_EFFORT`, recorded as that turn's error. A selection stored before a route changed what it declares therefore fails with a named reason instead of being answered under a level nobody chose.

**A resolved endpoint selects compatible catalog declarations.** Provider identity and endpoint metadata are checked before a legacy basename. A custom route may use a channel declaration when the models.dev API URL matches its HTTP(S) host, non-version path, and query parameters; the trailing `/v1`, `/anthropic`, and `/anthropic/v1` protocol suffixes are compatible. Multiple matching declarations must agree on control kind, toggle support, and effort values. An unrelated sibling provider, aggregator, or deployment path cannot lend its levels to the route.

## Alternatives considered

**Keep the uniform rows and let the request refuse.** A menu offering efforts the route cannot encode turns a configuration fact into a per-turn failure, and the only way to learn what a route accepts is to fail one.

**Downgrade to the nearest effort the route declares.** A silent substitution is the one outcome a person cannot detect: the turn succeeds, the transcript reads normally, and the answer was produced under a level nobody chose.

**Infer a route's levels from a sibling coding-plan channel without endpoint identity.** Two channels serving the same model are separate routes with separate vocabularies; only a unique, matching published API endpoint and an unambiguous declaration connect them.

**Render no control only for a model the catalog has never heard of.** Absence of reasoning metadata, not model identity, is the condition: a cataloged model on a route that declares no efforts has nothing to list either.

## Consequences

- The Session selector lists exactly the efforts the resolved route and model report, in adapter order, and preserves the exact default the route reports.
- A model whose resolved metadata declares no efforts renders no effort rows, so the absence is visible instead of being filled in by the harness.
- A stored explicit effort the exact route no longer lists is named unsupported rather than presented as the level in use; the effort pane's Default action clears it through the selection call, and rendering alone never rewrites the stored selection.
- A custom route matching the published coding-plan API endpoint can use the five current MiniMax M3.1 effort values; unrelated channels and paths cannot supply them.
- An effort the route does not accept still fails one turn with `UNSUPPORTED_REASONING_EFFORT`, so a selection stored under an earlier configuration keeps its named error instead of being answered under another level.
- Adding a level to the harness ladder changes nothing a person sees in this selector, so the ladder and the selector can no longer drift apart silently.

## Testing

Focused tests cover endpoint-associated provider declarations, conflicting endpoint claims, a toggle, an empty control list, and the DeepSeek alias that must resolve before its legacy basename. Captured local payloads cover MiniMax M3 Default/On/Off and M3.1's five efforts on Completions, Responses, and Anthropic APIs. Component tests cover a stored effort outside the route's exact subset and one with no metadata at all. A keyless browser snapshot covers localized toggle rows and the five declared effort rows; the browser test makes no provider request.
