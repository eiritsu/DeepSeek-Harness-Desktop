# Agent Note: Credential-gated external tools

Status: implemented

English | [中文](2026-09-04-external-tools-credential-gating.zh.md)

## Problem

Users need Hermes-style tools that become available after entering a provider API key, while DSH must keep secrets out of ordinary settings, plugin files, and session logs.

## Decision

`@deepseek-ai/dsh-external-tools` owns a provider catalog and registry. It resolves credentials through `dsh-credentials`, stores only provider state and endpoint overrides in settings, and registers or disposes provider tools when credentials or enablement change. The browser face adds a localized Tools & connections settings tab; the first release implements Brave Search, Tavily, Firecrawl, Exa, and GitHub HTTP tools while cataloguing future providers without exposing unsupported tools.

## Alternatives considered

**Store API keys in ordinary settings.** Rejected because settings are routinely exported and projected to clients; the credential service provides the required secret storage and redaction path.

**Expose every catalogued provider immediately.** Rejected because a catalog entry without a verified backend would create a misleading enabled state; unsupported providers remain visible only as deferred configuration metadata.

## Consequences

A configured provider is available to the next session without copying its secret into model-visible context or durable session data. Provider-specific connection tests, OAuth, and media/browser backends remain follow-up work, and provider errors are reduced to secret-free status diagnostics.
