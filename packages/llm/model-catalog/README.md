---
description: "One shared models.dev fact per canonical model — periodic refresh, bounded parsing, a durable last-good snapshot, and refusal instead of a guess — for the DeepSeek Harness."
kind: "package-reference"
---

# @deepseek-ai/dsh-model-catalog

English | [中文](README.zh.md)

## Summary

`@deepseek-ai/dsh-model-catalog` publishes one shared models.dev fact per canonical model, whatever channel serves it. It reads the catalog on an interval, parses it under a byte limit, and publishes each result as one immutable generation; adapters pin a generation for a whole operation, so a model is encoded from the facts it was described with. A failed refresh changes nothing: the last good generation stays published and, across a restart, stays on disk. A document that parses to nothing is refused, so a truncated response cannot replace good facts with none.

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

Mount this plugin when one composition serves the same model through more than one channel, or when the facts a model is described with should not come from whichever package happened to be installed most recently. It requires the storage domain, because the last-good snapshot is what a cold start with no reachable catalog answers from.

### When to choose it

Choose it for the facts, not for the requests. The catalog never talks to a provider and never decides a routing: it contributes what a model *is*, and the adapter still decides what a route can *send*. When it is mounted, its record outranks a route's own declaration for every field it carries, and the declaration answers only for what the catalog leaves open. A composition that mounts no catalog keeps every fact its adapters already carried.

### Configure the document and the mappings

Every field is optional; the defaults read the public models.dev catalog once a day.

```yaml
- name: '@deepseek-ai/dsh-model-catalog'
  config:
    catalogURL: https://models.dev/catalog.json?type=all
    refreshIntervalMs: 86400000
    requestTimeoutMs: 15000
    maxResponseBytes: 8388608
    aliases:
      - modelId: gpt-5
        canonicalId: openai/gpt-5
      - ownedBy: acme-gateway
        modelId: flagship
        canonicalId: zhipuai/glm-5.3-flash
```

| Field | Default | Meaning |
|---|---|---|
| `catalogURL` | the public models.dev catalog | JSON document carrying canonical models and per-channel entries |
| `aliases` | none | Route-local model ids mapped onto qualified canonical ids |
| `refreshIntervalMs` | `86400000` | Time a successfully read document stays fresh |
| `requestTimeoutMs` | `15000` | Longest wait for one request |
| `maxResponseBytes` | `8388608` | Largest response body read, enforced while the body streams |

A mapping whose `canonicalId` carries no owner, or whose `modelId` is empty, fails plugin loading. Two mappings claiming one route-local id under the same owner scope fail the same way, because a deployment that cannot say which canonical model it means has not said it.

### Address a model

Three ways in, in precedence order. A configured mapping decides the answer — including when it decides there is none, so a mapping naming a canonical id this generation does not carry resolves to nothing rather than falling through to a same-named model. Failing that, a qualified `owner/model` id is answered exactly, and a bare basename is answered only when exactly one owner publishes it. Every refusal is `undefined`: the adapter keeps whatever facts it had.

```ts
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-model-catalog'

declare const ctx: Context

const facts = ctx.modelCatalog.facts.facts({ model: 'gpt-5', ownedBy: 'openai' })
// { canonicalId: 'openai/gpt-5', contextWindow: 400_000, maxOutputTokens: 128_000, ... }
```

What a record carries is a property of the model, not of the channel serving it: the accepted modalities, the context window, the output ceiling, and whether it reasons at all. The one channel-specific part is `reasoningEfforts` — the levels this channel declares it accepts. An absent list means the channel says nothing; an empty list means it declares that it accepts none, which refuses every explicit level.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

### Source map

| File | Role |
|---|---|
| `src/facts.ts` | The published vocabulary: `ModelFacts`, `ModelFactsRequest`, `ModelFactsView` |
| `src/parse.ts` | Bounded reading of one document into canonical records and channel vocabularies |
| `src/resolve.ts` | `CatalogView`, the immutable generation, and its addressing rules |
| `src/service.ts` | The service: domain, periodic refresh, publish, and durable snapshot |
| `src/config.ts` | Configuration schema and the one place its defaults are applied |

### Generations

A refresh publishes a whole new `CatalogView`; a published view is never mutated. A consumer that must answer twice from the same facts — describing a model, then encoding a request against it — holds one view for the whole operation, and recognizes a refresh by the view's identity rather than by a number it would have to poll. `dsh-llm-pi-ai` builds its collection under exactly one view, so a refresh between a selector's read and a request's read produces two consistent snapshots rather than one mixed one.

### What is bounded

The byte limit is applied while the body streams, so an oversized or endless response is abandoned at the limit rather than after buffering whatever it chose to send. The request timeout bounds the wait. Parsing itself allocates nothing beyond what that bounded body already contains, and a record the document cannot address or says nothing about is skipped rather than guessed at.

### The durable snapshot

The `model_catalog` domain's global slot holds the last accepted document and the URL it was collected for. It exists so a cold start with no reachable catalog still has facts. A stored document naming another URL is discarded rather than read under configuration it was not collected for. A persistence failure is reported on its own and leaves the published facts in place: the next cold start is the only thing that loses.

-----

<a id="further-exploration"></a>
## Further Exploration

- [The LLM capability group](../README.md)
- [pi-ai-backed routes](../llm-pi-ai/README.md) — the adapter that reads these facts
- [The LLM service](../llm/README.md) — the model-info vocabulary the facts feed

-----

<a id="model-experience"></a>
## Model Experience

None, as the catalog answers an adapter's questions about a model and builds no request, prompt, tool, or parameter.

#### KV Cache effect

None. Nothing this package produces reaches a provider payload.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **No signature or publisher check.** The document is read over TLS from the configured URL and trusted as written. A deployment that needs to pin the publisher must serve the document itself and point `catalogURL` at it.
- **A stale ceiling can refuse a valid request.** A consumer that treats `maxOutputTokens` as a hard bound refuses a configured output cap the model would have accepted. The facts are as fresh as the last successful refresh, and nothing here guarantees they are current.
- **The vocabulary is the document's.** A fact this version of the parser does not know how to read is dropped, so a document that starts publishing new fields publishes them as silence until the parser learns them.

<a id="dev-note"></a>
### Dev Note

None.

**Runtime invariant:** No companion is published. The catalog publishes one immutable generation and recovers it from durable storage; it keeps no independently mutable relation to compare, and each consumer pins the generation it reads by the view's identity.
