---
description: "Browser compatibility entry for client plugins built before snapshot-store, settings, and slot APIs moved to their current packages."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-runtime

English | [中文](README.zh.md)

## Summary

This package keeps browser plugins built against the previous `@deepseek-ai/dsh-client-runtime/client` entry loadable beside plugins built for the current split client architecture. It forwards the former snapshot-store and settings types to their current owners and preserves the former `ClientContext` type without creating a second renderer, settings service, or slot registry. New plugins should import the owning packages directly.

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

Mount this package once in a Web composition that may load previous-version client bundles. Those bundles can continue to request `@deepseek-ai/dsh-client-runtime/client`; current bundles continue to request `dsh-client-store`, `dsh-client-ui-settings`, and `dsh-client-ui-renderer` directly. The standard Web bundle already mounts the compatibility entry.

Do not add new APIs here. A new client plugin should import each value or type from the package that owns it so its module-table requests remain explicit.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The browser entry re-exports `createSnapshotStore`, `defineStore`, `shallowEqual`, and their store types from `dsh-client-store`. It re-exports settings scope types from `dsh-client-ui-settings` and defines the former `ClientContext` as the current Cordis context plus the renderer-owned `SlotRegistry` type. `SlotRegistry` is type-only: exporting or constructing another runtime registry would split slot contributions between two instances. The host and browser `apply` functions are intentionally empty because current owner packages provide the implementations.

The package declares the renderer and settings packages as injected dependencies, so the client module graph materializes their current implementations before a legacy consumer executes.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Client module system](../modules/README.md) — module-table declarations, dynamic suppliers, and browser bundle loading.
- [Client packages](../README.md) — the current ownership split across the browser client.

-----

<a id="model-experience"></a>
## Model Experience

None, as this package only resolves browser imports and contributes no model-visible content.

#### KV Cache effect

None; no provider request is changed.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Previous-version entry only** — compatibility is limited to the exported snapshot-store functions, settings types, and `ClientContext` type used by supported external plugins; it is not a general archive of removed client APIs.
- **No duplicate runtime services** — values now owned by renderer or settings remain owned there, so code that depended on private runtime internals must migrate.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

Keep the forwarding surface driven by installed external-plugin evidence. Add an export only when a supported previous-version bundle requests it and a single current package already owns the same behavior.

</details>
