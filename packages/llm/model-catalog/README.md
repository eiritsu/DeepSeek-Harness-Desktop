---
description: "Live models.dev metadata enrichment for model discovery and prepared calls."
kind: "package-bundle"
---

# `@deepseek-ai/dsh-model-catalog`

English | [中文](README.zh.md)

## Summary

`dsh-model-catalog` keeps Desktop model metadata current from `models.dev`. It enriches discovery and prepared calls with declared modalities, context and output limits, and reasoning levels; missing fields fall back to pi-ai's installed catalog. The shipped Desktop profiles enable it without creating a provider route or rewriting provider settings. Choose it when model declarations must update independently of the application; refresh adds one bounded network request and retains the last successful snapshot when the request fails.

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

| Config | Default | Meaning |
| --- | --- | --- |
| `catalogURL` | `https://models.dev/api.json` | Dynamic provider/model catalog. |
| `refreshIntervalMs` | `86400000` | Freshness interval for the last successful snapshot. |
| `requestTimeoutMs` | `15000` | Remote refresh deadline. |
| `maxResponseBytes` | `8388608` | Actual-byte ceiling for one catalog response. |

```sh
dsh plugin --profile <custom-profile> add @deepseek-ai/dsh-model-catalog
```

The package declares `dsh.bundle.patch`, so custom-profile installation adds it to the ordered Bundle list. The shipped Lite and Electron overlays mount it directly; custom Bundles remain in place.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The Bundle mounts one Host plugin. The plugin persists the complete upstream JSON, projects normalized fields through effect-scoped LLM resolvers, and keeps provider configuration under its existing owner.

### Resolution and refresh

The catalog marks upstream modality, context, output-capacity, and reasoning fields as `authoritative`, so they replace stale local values in model discovery and prepared calls. A field absent upstream remains local. Discovery fields reported by the endpoint and values from earlier enrichers still take precedence.

A recognized `owned_by` value selects that provider's declaration. An exact configured `baseURL` match against one provider API supplies the same identity for a local route alias. Without either identity, capacities use the smallest same-ID declaration, input modalities use their intersection, and reasoning requires identical declarations. Route names, protocols, partial URLs, and model-name patterns provide no capability evidence.

A discovery or exact-model lookup refreshes a stale snapshot. Concurrent lookups share one refresh; success replaces the snapshot and failure retains the last successful data. Model IDs match case-insensitively, and uncovered fields use the installed pi-ai catalog.

### Required Harness extension points

This Bundle is independently packaged but requires model-metadata extension points that are not present in an unmodified DSH runtime:

- `@deepseek-ai/dsh-llm` provides ordered model-discovery enrichment plus exact input and capacity resolver APIs. Their owning implementation lives in `packages/llm/llm/src/index.ts` and their public types live in `packages/llm/llm/src/types.ts` in the Harness source tree.
- `@deepseek-ai/dsh-llm-pi-ai` supplies exact owner and endpoint metadata to those resolvers before applying its installed-catalog fallback. The owning adapter integration lives in `packages/llm/llm-pi-ai/src/adapter.ts`.
- Host model discovery and the Models settings page preserve the upstream `owned_by` value and optional `inputModalities`, so a gateway model can be matched against the correct catalog owner.

The package contributes catalog data through these APIs; it does not add the APIs, infer reasoning-effort support, or rewrite provider settings. A DSH build without these extension points is incompatible.

No runtime invariant companion is published because snapshot validation and lookup tests own correctness, with no independently observable in-process relationship.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [LLM service](../llm/README.md) — metadata registration, discovery, and call preparation.
- [pi-ai adapter](../llm-pi-ai/README.md) — provider configuration and runtime dispatch.
- [Lite desktop](../../../desktop-shell/README.md) — the native macOS profile that embeds this Bundle.
- [Electron desktop](../../../apps/desktop/README.md) — the cross-platform profile that embeds this Bundle.

-----

<a id="model-experience"></a>

## Model Experience

### Dynamic native attachment admission

#### What the model sees

The plugin emits no text. It copies the complete `models.dev` input declaration (`text`, `image`, `audio`, `video`, and `pdf`). The owning adapter intersects that declaration with the selected wire protocol's implemented serializers: supported attachments remain native, while `Deepseek-Files` produces durable recognition text for unsupported media.

#### Token effect

The plugin adds no fixed tokens. An admitted attachment contributes the provider's normal image tokens and any adapter-owned image description.

#### KV Cache effect

Admitting an image changes request content and its cache identity exactly as a provider-native image request would. Unchanged discovery metadata adds no further cache variation.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Refresh is demand-driven** — the plugin checks staleness during model discovery or an exact runtime lookup; it does not poll in the background or silently rewrite saved model rows. An earlier cache is marked stale once so endpoint identities and capacities are fetched and persisted on the next lookup.
- **Opaque ownership is conservative** — without a recognized `owned_by` or exact provider endpoint match, capacities use the smallest same-ID declaration and input modalities use their intersection; reasoning still requires identical declarations, and provider-specific extras never combine.
- **Only implemented transports become effective** — the catalog may declare `audio`, `video`, or `pdf`, but `llm-pi-ai` exposes those modalities only on Google protocols that serialize arbitrary inline media. Other protocols keep `text/image` and use recognition fallback.
- **Output capability is not a request default** — `limit.output` sizes the provider model descriptor but does not become a request `maxTokens` value unless the provider profile explicitly configured one.
- **Reasoning levels require an upstream declaration** — only standard levels in `reasoning_options` entries of type `effort` become model capabilities; the plugin does not guess levels when the source omits them.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
