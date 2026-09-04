---
description: "Credential-gated external providers that register model tools after a user configures a key in DSH settings."
kind: "package-reference"
---

# @deepseek-ai/dsh-external-tools

English | [中文](README.zh.md)

## Summary

`dsh-external-tools` connects selected external providers to DSH through the credential service. A provider becomes a model tool only after its credential is configured and the provider is enabled in Settings → Tools & connections. Secrets are resolved at call time and never enter ordinary settings, plugin files, or session logs.

## Table of Contents

- [Use this package](#use-this-package)
- [Provider lifecycle](#provider-lifecycle)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

The base and web-app bundles mount this plugin. It requires `tools`, `credentials`, and `settings` on the host; the browser face contributes a Settings → Tools & connections tab through the existing settings slots.

The initial providers are Brave Search, Tavily, Firecrawl, Exa, and GitHub. FAL, ElevenLabs, and Browserbase are catalogued for credential UX and can be implemented without changing the settings surface.

<a id="provider-lifecycle"></a>
## Provider lifecycle

Each catalog entry declares an id, display name, capabilities, credential reference, optional endpoint, and tool name. The registry listens for credential changes and settings changes, then registers or disposes the provider's tool. Disabled providers remain configured but do not register a tool. Endpoint overrides are stored as ordinary settings; credential values are stored only by the credential service.

The HTTP providers validate status codes and JSON object responses. A missing credential fails at tool execution time with a secret-free diagnostic, while provider errors expose only the HTTP status.

<a id="dev-note"></a>
## Dev Note

Add a provider to `src/catalog.ts`, implement its tool in `src/providers.ts`, and keep credentials behind `credentialRef`. Do not read secrets from config files or emit them in diagnostics. Update both bundle compositions when the package becomes required by a profile.

<a id="model-experience"></a>
## Model Experience

### Provider tools

#### What the model sees

The model sees only tools for providers that are configured and enabled by `dsh-external-tools`. Each tool returns provider JSON or a secret-free HTTP error; the credential value is never included in the schema, prompt, or result.

#### Token effect

Each enabled provider contributes one tool schema to the request. The cost is conditional on the user's enabled providers.

#### KV Cache effect

Changing enabled providers changes the tool prefix from the first changed schema token. Calls with an unchanged provider set keep the prefix stable.

## Known Limitations and Deferred Work

- Provider connection tests, OAuth flows, and the catalogued media/browser providers are not implemented yet.
- The first release exposes API-key credentials and HTTP search/extraction tools; provider-specific quotas and advanced parameters remain provider-owned work.
