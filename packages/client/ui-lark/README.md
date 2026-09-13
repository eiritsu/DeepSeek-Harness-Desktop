---
description: "Typed Lark and Feishu application, OAuth, permission, and private-chat status settings for the Web client."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-lark

English | [中文](README.zh.md)

## Summary

`dsh-client-ui-lark` contributes the **Lark Management** Settings section used by both desktop products. It mounts the generated `@deepseek-ai/dsh-lark/remote` client, presents official quick connect or self-built application setup, keeps App Secret write-only, separates application and current-user authorization, reports private-chat status, and copies the permission template without rendering its JSON.

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

Mount this Client plugin in a Web composition whose Host also mounts `@deepseek-ai/dsh-lark`. The current Electron `desktop` and Swift `desktop-lite` compositions already provide both halves. The section loads only after the typed Remote contribution is available.

Users can create a managed application, connect an existing application, continue a pending user OAuth flow after reopening Settings or restarting the app, inspect bot/user identities and missing scopes, and monitor the private-chat channel.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

`src/client/index.ts` mounts the generated Remote declaration, waits for the required UI services, registers typed English and Chinese dictionaries, and contributes one `settings.section` row. `LarkManagementController` owns the observable Remote state. The section sends typed management calls and receives only redacted status; browser code never receives a saved App Secret or CLI filesystem access.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Lark Host capability](../../lark/lark/README.md) — credentials, CLI, permissions, and private-chat Sessions.
- [Settings UI](../ui-settings/README.md) — extension point used by this package.
- [Remote API](../../api/remotes/README.md) — typed Host-to-Client transport.

-----

<a id="model-experience"></a>
## Model Experience

### Management UI

#### What the model sees

Nothing directly. This package contributes Client settings UI; the Host Lark package independently owns the model-visible `lark_cli` tool and logged chat input.

#### Token effect

None from opening, editing, or refreshing the Settings section.

#### KV Cache effect

None; the Settings Remote is outside model requests.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- The section requires the matching Host Remote and does not provide a standalone browser-only Lark client.
- OAuth completion and permission status depend on Lark/Feishu network availability and application configuration.

No runtime invariant companion is published; this client Settings projection owns no durable state beyond its Host Remote snapshot.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The migrated package uses current Cordis Client context, renderer, store, locale, Settings slots, and generated Typert artifacts. Keep its product copy in `src/client/locales.ts`.

</details>
