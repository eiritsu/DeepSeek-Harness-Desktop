# Agent Note: One shared model catalog and one reasoning ladder

Status: implemented

English | [中文](2026-09-29-shared-model-catalog-and-reasoning-ladder.zh.md)

## Problem

A model's facts — its input modalities, its context window, its output ceiling, whether it reasons — were whatever the provider that happened to serve it already knew. The same model behind an OpenAI-compatible gateway, behind DeepSeek's own route, and behind pi-ai's installed catalog reported three different sets, so a selector's description of a model changed with the channel serving it, and a deployment had to restate a fact per route to get a consistent answer.

The reasoning levels had the same kind of problem one level up: `LlmResolvedModelInfo.reasoning.efforts` listed the levels a route could encode, each selector rendered exactly that list, and a model that declared nothing had no effort menu at all. The same model therefore offered different rows on different channels, and a hand-entered model offered none. Making the rows uniform instead — the decision below — traded that inconsistency for a menu that described neither the model nor the route; [exact route reasoning selection](../bug-fix/2026-10-01-exact-route-reasoning-selection.md) records the correction.

## Decision

**A fact belongs to the model; an encoding belongs to the channel.** `packages/llm/model-catalog` publishes one generation of canonical per-model facts from the models.dev catalog (`https://models.dev/catalog.json?type=all`) through `ctx.modelCatalog`. The document is read on an interval, parsed under a byte limit, and the last accepted generation is also kept in durable storage, so a cold start with no reachable catalog answers from the snapshot it last collected. A failed refresh leaves the published generation in place: an unreachable catalog costs freshness and nothing else, and a document that parses to nothing is rejected rather than published.

Addressing a route-local model id onto a canonical record has three forms in precedence order — an explicit deployment mapping, an exact qualified `owner/model` id, and a bare basename — and each refuses rather than guesses. A basename two owners publish resolves to nothing, two mappings claiming one id resolve to nothing, and a stored snapshot collected for a different `catalogURL` is discarded rather than read under configuration it was not collected for.

The effort vocabulary is the one part that is not a fact, because it is what a channel can put on the wire. The catalog reports it per channel, and an adapter intersects that with its own transport before reporting what it can encode. `ModelFacts.maxOutputTokens` is a ceiling on what a request default may claim, never a request default: the output budget a deployment configures is its own choice.

**The catalog wins, then explicit configuration, then the installed adapter catalog.** `dsh-llm-pi-ai` reads the shared facts first and keeps what a profile entry declared itself (`declaredFacts`) only for the fields the record leaves open, so a deployment's own value answers where the catalog has none. A consumer that must answer twice from the same answer — describing a model in a selector and encoding a request against it — holds one `ModelFactsView` for the whole operation; a refresh publishes a new view object and never mutates a published one.

**The ladder is a harness decision, superseded for the Session selector.** `modelReasoningEfforts()` in `dsh-llm` publishes `minimal`, `low`, `medium`, `high`, `xhigh`, and `max` in escalation order, and every selector rendered exactly those rows for every model instead of the route's own set. `Default` is not a level: it is the choice to send no effort, which leaves the provider's default — or the route-configured one `prepareCall` materializes — in force. The Session selector no longer renders those rows: it lists the exact efforts the resolved route and model report, in adapter order, and renders no effort control when that metadata is absent ([exact route reasoning selection](../bug-fix/2026-10-01-exact-route-reasoning-selection.md)).

**Selection stores intent; the request judges capability.** `SessionController.selectModel` validates that the exact model is advertised and nothing more, and ACP's `setSessionConfigOption` resolves the route without the effort stored beside it. A level the route cannot encode is kept as the selection, reported back as the current value, and refused by the request that carries it as `UNSUPPORTED_REASONING_EFFORT`, recorded as that turn's error — including a value stored before the route changed what it declares. `Default` stores no effort at all, so a materialized default is never written back as something a person chose.

## Alternatives considered

**Render the route's own encodable levels, hiding the rest.** This is what 0.2 did, and what the Session selector does now: it lists the exact efforts the resolved route and model report and omits the control when the route declares none. The objection recorded here still holds against it — a level a later adapter release will enable is discoverable only by editing configuration — and it is the cost of a menu that describes one route.

**Downgrade an unencodable level to the nearest encodable one.** A silent substitution is the one outcome a person cannot detect: the turn succeeds, the transcript reads normally, and the answer was produced under a level nobody chose. This stays rejected: the selector never substitutes a nearby effort, and an unsupported explicit effort still fails at the request.

**Refuse the level at selection time.** The Session selector omits an effort the route does not report, so the surface no longer advertises the choice, and selection still validates only that the exact model is advertised. Refusing there would also put two unrelated checks in one operation: whether the model exists, which is a catalog question, and whether the route can encode a level, which is a transport question answered by the transport.

**Make `maxOutputTokens` the request default.** The catalog knows the model's ceiling, not what this conversation should spend. A deployment setting a smaller budget would have it overwritten by the next refresh.

**Let explicit configuration override the catalog.** A route that restated a field would answer from its own entry alone, so the same model could still report three different fact sets across channels and one route's local value would hide the catalog's answer from every other. The catalog is the shared fact; a local entry answers only where the catalog has none.

## Consequences

- Two routes serving one model report the same modalities, context window, and output ceiling even when one route's configuration declares a conflicting value; a local entry answers only for the fields the shared record leaves open.
- The Session selector lists the exact efforts the resolved route and model report, in adapter order, and shows no effort control when that metadata is absent. An effort the route does not accept — a selection stored before the route changed, or a forged value — fails one turn with `UNSUPPORTED_REASONING_EFFORT` instead of changing the answer.
- A wrong or unreachable catalog degrades metadata freshness only: request execution, the effort vocabulary an adapter declares, and every route absent from the catalog keep working, and a model the catalog has never heard of keeps the facts its own configuration declared.
- The selector shows what one route currently accepts, so a person cannot see from the menu which levels another route, or a later adapter release, will accept. The configuration reference and the turn error name what a route does accept.
- The durable snapshot is a cache of one `catalogURL`: a deployment that repoints the URL starts with no facts until the new document is read, rather than with the previous endpoint's.
