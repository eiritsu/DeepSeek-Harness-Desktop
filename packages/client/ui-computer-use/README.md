---
description: "Computer Use settings section for the desktop Web client: one master toggle for the native desktop-control runtime."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-computer-use

English | [中文](README.zh.md)

## Summary

`dsh-client-ui-computer-use` contributes the **Computer Use** Settings section used by both desktop products. The section carries the native desktop-control master toggle and its current status, and writes the durable `enabled` field of the native Cua Driver provider's settings namespace through `ctx.settingsScope`. It registers only while the Host serves that namespace, so a composition that does not mount the provider shows neither the page nor its navigation entry.

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

Mount this Client plugin in a Web composition whose Host also mounts `@deepseek-ai/dsh-computer-use-cua-driver-native`. The current Electron `desktop` and Swift `desktop-lite` compositions already provide both halves. Turning the toggle off tears the native runtime down and releases the computer-use registration; turning it on initializes the runtime again. The page renders only while the Host serves the namespace, so a deployment without the provider shows no trace of it.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

`src/client/index.ts` binds the provider namespace through `ctx.settingsScope`, registers the English and Chinese dictionaries, and contributes one `settings.section` entry. The contribution is availability-gated: the scope's `ready` status registers the section, and a later `unavailable` status — including one delivered by a reconnect — removes it. `src/settings-contract.ts` restates the namespace, field, and default as browser-local literals, because a browser half cannot value-import the Host plugin.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Cua Driver native provider](../../computer-use/cua-driver-native/README.md) — the Host runtime this section toggles.
- [Computer use subsystem](../../../docs/subsystems/computer-use.md) — the provider seam and its lifetime.
- [Settings UI](../ui-settings/README.md) — the slot and scope extension points used by this package.

-----

<a id="model-experience"></a>
## Model Experience

### Runtime toggle

#### What the model sees

Nothing directly. This package contributes Client settings UI; the Host provider independently owns the `cua_driver_native__*` tool schemas and the computer-use guidance section, which are present only while the durable setting is enabled.

#### Token effect

Enabling the runtime adds the provider's tool schemas and its fixed guidance section to subsequent requests; disabling removes both. Requests already in flight are unaffected.

#### KV Cache effect

The toggle changes the tool-schema prefix and the prompt's guidance section, so the first request after a change cannot reuse a cache prefix that predates it.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- The section is mounted only by the Electron `desktop` and Swift `desktop-lite` compositions; the `web` profile does not load it.
- The toggle releases and retakes the same exclusive computer-use registration, so it cannot switch to a different provider.
- The section exists only while the Host serves the provider namespace; a composition that omits the provider row, or marks that Cordis row `disabled`, renders no navigation entry, while the runtime toggle leaves the row mounted and the section visible.

No runtime invariant companion is published; this client Settings section mirrors one Host settings namespace and owns no independently observed state.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

Keep product copy in `src/client/locales.ts`. The namespace, field, and default literals in `src/settings-contract.ts` are pinned by `tests/settings-contract.client.spec.ts`; the Host provider pins the same values in its own suite, so a change to either side must update both.

</details>
