# Agent Note: Refreshed catalogs own current model capacities

Status: implemented

English | [中文](2026-08-27-dynamic-model-capacity-resolution.zh.md)

## Problem

Provider model catalogs are released independently. A newly published model can appear in `models.dev` before the installed pi-ai dependency describes it, while an adopted settings row can preserve a capacity that was accurate when discovery ran. Treating either value as permanently authoritative makes context pressure, compaction thresholds, overflow classification, and the provider model descriptor stale until code or settings are edited manually.

Output capability and the request output default are different values. Refreshing a model's maximum output must not silently add or change the `maxTokens` sent on each request.

## Decision

`LlmRuntime` owns an ordered, disposable `registerModelCapacityResolver()` registry and the corresponding `resolveModelCapacity()` query. A resolver returns positive integer `contextWindow`, `maxOutputTokens`, or both for one exact route/model identity. The first non-empty answer wins. The runtime validates and detaches it before returning.

`llm-pi-ai` queries external capacity for every configured exact model while preparing the immutable adapter call. Returned values replace the materialized pi-ai model's context and output capabilities for metadata reporting and provider dispatch. They do not enter `configuredMaxTokens`; only an explicit provider-profile `maxTokens` remains a `defaultMaxTokens` request cap.

`dsh-model-catalog` copies `models.dev` provider API endpoints, `limit.context`, and `limit.output` beside input modalities into its last-good snapshot. A recognized owner selects its exact declaration. If the owner is a local alias, an exact configured endpoint match selects the corresponding catalog provider instead. Otherwise each field independently requires same-id consensus, so agreement about output remains usable when context differs. Fields absent from dynamic data fall back to pi-ai's installed catalog. The persisted payload carries an internal format marker; an earlier cache remains readable but is treated as stale once, so the next demand-driven lookup replaces it with endpoint- and capacity-aware data without changing the storage domain version.

Discovery enrichment remains fill-only because the endpoint response is authoritative for the draft being edited. Runtime capacity resolution is current catalog capability and may replace stale installed or saved values without rewriting settings.

## Alternatives considered

- **Rewrite provider settings after each refresh** — rejected because catalog refresh would mutate user-owned configuration and create unrelated settings churn.
- **Treat saved capacity as an explicit deployment override** — rejected because the Models page also saves discovered values, so the persisted field cannot distinguish a deliberate gateway limit from an old catalog copy.
- **Map `limit.output` to `defaultMaxTokens`** — rejected because a model hard capability is not a deployment-selected per-request output cap.
- **Bump the storage domain version** — rejected because the cache is derived, the old payload remains structurally readable, and a format marker can request one safe refresh without a migration-only domain failure.

## Consequences

New model capacities become effective after the first lookup following the normal refresh interval. The Web context meter, compaction, overflow handling, and pi-ai dispatch share the same resolved context capacity. A transient catalog failure retains the last-good data, including capacities. Operators serving gateway-specific limits can disable or replace the optional catalog Bundle; the core adapter retains its configured and installed fallbacks when no resolver answers.

## Testing

Core tests cover resolver ordering, detachment, disposal, and invalid capacities. Adapter tests prove that refreshed values replace stale model capabilities while an explicit request default remains unchanged. Catalog tests cover parsing, exact-owner, exact-endpoint and consensus resolution, legacy-cache refresh, durable provider and capacity fields, and unload behavior. The real Loader composition resolves a saved 131,072-token GLM-5.3-Flash row through its Zhipu Coding Plan endpoint to a 1,000,000-token context. The Web scenario seeds `request/context` from that exact runtime resolution and snapshots the visible `1M` context meter.
