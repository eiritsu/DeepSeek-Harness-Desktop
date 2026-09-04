# Agent Note: native search provider selection is credential-gated

Status: implemented

English | [中文](2026-09-04-native-search-provider-selection.zh.md)

## Problem

The desktop composition mounted the DeepSeek native search provider and the external-tools registry independently. The DeepSeek adapter treated the presence of an asynchronous resolver as availability, so adding a Tavily key could leave more than one native search provider usable. The external registry exposed Tavily, Brave Search, and Exa only as provider-specific model tools. OpenAI-compatible gateways could also omit `arguments` on a Responses `function_call_arguments.done` event, which crashed the parser before any web provider ran.

## Decision

External search adapters register through `ctx.web` as well as their dedicated tools. The registry selects one configured and enabled search adapter using the saved `searchPriority` order, defaulting to Tavily, Brave Search, then Exa. The desktop DeepSeek adapter gates automatic availability on resolved credential presence, while explicit non-desktop compositions retain their existing resolver behavior. The pinned pi-ai parser preserves the already assembled function arguments when a gateway omits the completion field instead of dereferencing `undefined`.

## Verification

Focused provider tests cover normalized Tavily, Brave Search, and Exa responses, Tavily request headers and redirect rejection, and withholding an unconfigured adapter. Existing DeepSeek provider and loader tests pass. TypeScript host and client checks pass for the changed packages. The desktop smoke must use the rebuilt runtime so the patched dependency and provider registry are both shipped together.

## Alternatives considered

**Register every configured search backend in `ctx.web`.** Rejected because the web seam correctly refuses registration-order-dependent selection; a saved priority is the product-owned choice for deployments that configure several API keys.

**Make the model choose `tavily_search` instead of `web_search`.** Rejected because it duplicates the native search contract and makes provider choice prompt-dependent. The native seam should select the configured backend before the model sees results.

**Treat a resolver function as proof that a provider is available.** Rejected for the desktop composition because the resolver can resolve to no value; advertising that provider alongside a configured external backend produces ambiguity before a request can report the missing credential.

## Consequences

The native `web_search` tool no longer depends on the model choosing `tavily_search`, and an unset key never causes a request. Dedicated provider tools remain available for provider-specific operations. Changing search priority or an endpoint takes effect on the next reconciliation; the WebRuntime override selects one external adapter even when the built-in DeepSeek adapter is also mounted.
