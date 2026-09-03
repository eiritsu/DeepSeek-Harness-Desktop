---
description: "Desktop-only plugin discovery, immutable-source review, installation, removal, and audit UI for the macOS WKWebView shell."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-plugin-library

English | [中文](README.zh.md)

## Summary

`dsh-client-ui-plugin-library` adds a plugin-management entry and overlay when the macOS shell exposes `window.dshDesktopPluginBridge`. It lists built-in Web profile bundles and out-of-tree dependencies, discovers community projects, reviews immutable or local sources, and delegates approved mutations to the native shell. Installed plugin dependencies and Skill data live in the desktop app's Application Support data directory. A normal browser receives the same package in the Web composition but no UI registration because the privileged bridge is absent. Source review is an installation preflight, not a sandbox or publisher endorsement.

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

The shipped Web application mounts this package, but it becomes visible only inside the matching macOS shell. Open **Plugin library** from the sidebar footer to inspect profile dependencies, check public npm updates, review a source, remove a dependency, or read the native audit log.

### Review and install a source

Review accepts an exact npm version, an HTTPS GitHub repository pinned to a commit, or a local directory. Direct installation requires a valid root package manifest whose `dsh.bundle.patch` names an existing package-internal YAML entry. The native bridge issues a single-use 15-minute review token and delegates installation to `dsh plugin --profile web` with exact saving and dependency lifecycle scripts disabled.

Community discovery uses the [SkillHub Plugins catalog](https://skillhub.cloud.tencent.com/plugins) as its only external source. Catalog metadata is only a discovery signal; the selected GitHub repository is pinned to a commit and must pass local structural review before installation.

### Mount in another Web composition

Mount the browser plugin as a normal Cordis config entry. It has no public configuration fields and remains inert unless the document-start bridge exists.

```yaml
- name: '@deepseek-ai/dsh-client-ui-plugin-library'
```

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The plugin treats the native bridge as its capability signal, registers localized copy, then contributes one `sidebar.footer.action` entry and one `shell.overlay` entry through the existing slot registry. One controller shares overlay visibility between the two contributions. The native shell owns source pinning, package inspection, command execution, audit persistence, and restart behavior; browser code owns only presentation and typed request/reply projection.

| File | Role |
|---|---|
| [`src/client/index.ts`](src/client/index.ts) | Bridge gate, locale registration, and slot contributions |
| [`src/client/bridge.ts`](src/client/bridge.ts) | Typed native request/reply vocabulary |
| [`src/client/PluginLibraryOverlay.tsx`](src/client/PluginLibraryOverlay.tsx) | Inventory, review, discovery, and audit presentation |
| [`cordis.patch.yml`](cordis.patch.yml) | Portable composition row matching the built-in Web entry |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [macOS desktop shell](../../../desktop-shell/README.md) — native bridge, lifecycle, updates, and trust limits.
- [UI slot system](../ui-slots/README.md) — typed additive registration used by the trigger and overlay.
- [Web application bundle](../../bundle/web-app/README.md) — composition that mounts this browser plugin.
- [Plugin commands](../../../apps/cli/reference/README.md) — profile dependency lifecycle delegated to by the shell.

-----

<a id="model-experience"></a>
## Model Experience

None, as the package contributes desktop management UI and registers no model tools, prompt text, or provider traffic.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits describe the trust and compatibility scope of the desktop installer.

- **No runtime confinement** — structural review, immutable source pinning, and disabled lifecycle scripts do not confine an activated plugin's file, network, process, or credential access.
- **No package-level enable switch** — activation belongs to Cordis config entries, while one npm package may contribute several entries.
- **Lifecycle-dependent packages can fail** — packages that require `prepare` or another dependency lifecycle script may not work through this installation path.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
