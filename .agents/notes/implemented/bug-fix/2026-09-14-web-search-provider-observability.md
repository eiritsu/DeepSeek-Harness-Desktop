# Agent Note: Web search provider observability

Status: implemented

English | [中文](2026-09-14-web-search-provider-observability.zh.md)

## Problem

The provider-neutral `web_search` tool exposed the selected backend's answer and sources but not its identity. A desktop user who configured Tavily could receive Tavily URLs through the generic tool while the transcript and result card gave no evidence that Tavily served the request. The model could then incorrectly describe the call as native search, especially because the dedicated `tavily_search` tool remained visible beside `web_search`.

## Decision

The web service adds the selected search provider id to every normalized `WebSearchResult` after provider execution. This service-owned value overrides any provider-returned field and therefore records the provider selected by the live override, static configuration, or unique-provider resolution policy.

`dsh-tool-web` projects the id into model-facing output, structured presentation metadata, and the result-card title. Multi-query results retain the provider id with the merged sources. Existing provider implementations remain source-compatible because the field is optional for values they return directly; calls through `ctx.web.search()` always receive it.

## Alternatives considered

**Infer the provider from source URLs.** Rejected because results can include third-party domains unrelated to the API vendor, and the same URLs can appear through several providers.

**Hide dedicated provider tools when generic search selects the same provider.** Rejected because dedicated tools can expose provider-specific behavior and their registration is an independent external-tools setting. Hiding them would not make historical generic calls observable.

**Log the provider only in desktop diagnostics.** Rejected because the ambiguity exists in the portable tool result, replay, and every client presentation rather than only in one shell.

## Consequences

Models and users can verify that a generic search ran through `tavily`, `brave-search`, `exa`, or another registered id. Tool-output schemas and recorded snapshots include the new optional field, and old persisted presentation metadata without it continues to render with the prior title. Released multi-Session fixtures retain their recorded generations and use child-prompt sidecars for the current reconstructed prompt.

Focused web-service and tool tests pin provider ownership, rendered output, metadata parsing, and backward compatibility.
