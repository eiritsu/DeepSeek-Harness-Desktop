# Agent Note: Model discovery metadata is enriched by ordered plugins

Status: implemented

English | [中文](2026-08-24-model-discovery-enrichment-plugins.zh.md)

## Problem

The [draft endpoint interrogation](2026-08-04-draft-provider-endpoint-interrogation.md) preserves metadata an endpoint explicitly returns, but many OpenAI-compatible gateways return only an id and `owned_by`. Their upstream model catalogs may know exact input modalities, while the gateway omits them. Treating the omission as text-only blocks images before request construction; treating every omitted value as image-capable invents a capability and can persist an image before the provider rejects it. The existing [per-route modality declaration](2026-08-12-pi-ai-route-default-input-modalities.md) is an accurate manual fallback but should not be repeated when an installed catalog already has an exact declaration.

Provider adapters must not absorb every external catalog. Doing so couples generic endpoint interrogation to unrelated release cadences and makes a local catalog addition vulnerable to replacement whenever an adapter is updated.

## Decision

`LlmRuntime` owns an ordered, disposable `registerModelDiscoveryEnricher()` registry. An enricher receives detached normalized candidates, the original draft, and its settings namespace. It may return metadata patches only for model ids the provider already discovered. Provider-disclosed fields win, then earlier enrichers, then later enrichers; no registration may add a model or replace an existing value.

The runtime also owns an ordered `registerModelInputResolver()` registry for exact route/model lookups. The first resolver with an answer wins; `undefined` delegates. `llm-pi-ai` consults it unless a per-model profile explicitly pins `input`, so exact external metadata can complete the installed catalog instead of only filling catalog misses. The adapter intersects the declaration with serializers implemented by the exact wire protocol and applies that effective list to capability reporting and the immutable call snapshot, so admission and serialization cannot disagree.

`LlmDiscoveredModel.ownedBy` preserves the endpoint's explicit owner identifier. The `@deepseek-ai/dsh-model-catalog` Profile Bundle refreshes `models.dev` when discovery or an exact runtime lookup finds its durable snapshot stale, retains the last-good snapshot on failure, and falls back to the installed pi-ai catalog for ids absent from dynamic data. A recognized owner selects that provider's exact dynamic entry; absent or gateway-specific ownership requires exact-id consensus across dynamic entries. It copies the complete `text`, `image`, `audio`, `video`, and `pdf` input declaration. Conflicting or unknown ids remain unchanged, and it never infers from route keys, wire protocols, display names, or model-id patterns.

The shipped Web profile includes the catalog Bundle after `Deepseek-Files`. Profile normalization inserts either missing default Bundle after the installation-owned Web application prefix while preserving third-party Bundle entries. The catalog remains an independent Bundle that custom profiles can add through the ordinary profile package lifecycle. Adopting a refreshed candidate still persists the enriched per-model `input` declaration in settings, while runtime lookup serves existing rows without rewriting them.

## Alternatives considered

- **Embed pi-ai fallback inside `llm-pi-ai` discovery** — rejected because the gateway adapter would own a supplemental catalog that applies independently of its transport and could not be removed or upgraded as a profile unit.
- **Infer vision support from model ids, provider routes, or `openai-responses`** — rejected because none is a capability declaration and mixed routes are ordinary.
- **Let enrichers replace endpoint metadata** — rejected because a local static catalog must not override a deployment's explicit declaration.
- **Mutate existing settings automatically at plugin startup** — rejected because discovery is a draft operation and the catalog must not silently rewrite user-owned provider configuration.

## Consequences

A configured model without an explicit per-model declaration receives effective modalities immediately when the default catalog has an exact owner match or exact-id consensus. Google protocols expose native audio, video, and PDF alongside image input because their pi-ai serializers emit arbitrary inline media; OpenAI-compatible protocols remain `text/image` and use recognition fallback. Fetch Models exposes the complete declaration for adoption, while existing rows require no rewrite. Ambiguous ids retain the route's conservative fallback.

The core seam is generic and contains no pi-ai or remote-catalog imports. Other catalogs can ship independent Profile Bundles with the same fill-only rules, and unloading one withdraws only its registrations. Dynamic freshness follows the configured refresh interval; the persisted last-good snapshot keeps discovery usable across restarts and transient catalog outages.

## Testing

`packages/llm/llm/tests/topology.spec.ts` pins ordering, fill-only precedence, unknown-id rejection, detachment, and disposal for both registries. `packages/llm/llm-pi-ai/tests/adapter.spec.ts` pins the prepared dispatch's use of externally resolved modalities. `packages/llm/model-catalog/tests/catalog.spec.ts` pins all five dynamic modalities, exact-owner selection, exact-id consensus, pi-ai fallback, conflict preservation, disposal, and the Profile Bundle manifest. `packages/llm/model-catalog/tests/loader-composition.spec.ts` boots the package through the real Loader and storage stack, then verifies that an A6 `openai-responses` route exposes only its implemented `text/image` transport, a Google route exposes all five modalities, and an explicit text-only declaration remains authoritative. `packages/boot/app-boot/tests/profile.spec.ts` pins first-use defaults and migration of existing Web profiles that retain custom Bundle entries.
