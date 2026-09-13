---
description: "Desktop SkillHub discovery, review, installation, and removal UI shared by the Swift and Electron shells."
kind: "package-bundle"
---

# @deepseek-ai/dsh-client-ui-skill-library

English | [中文](README.zh.md)

## Summary

`dsh-client-ui-skill-library` adds a Skill Library sidebar entry and shell overlay when either desktop shell exposes its narrow bridge. It discovers SkillHub skills, filters and paginates the catalog, opens the selected SkillHub page, and asks Swift or Electron to validate and install selected archives into `$DSH_HOME/skills`.

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

The Web application mounts this package, but the entry is visible only inside a matching Swift or Electron shell. Open **Skill Library** from the sidebar to browse SkillHub skills, narrow results by source, scene, or API key, install a package into the desktop-managed skill root, or remove one exact installed Skill.

### Mount in another Web composition

Mount the browser plugin as a normal Cordis config entry. It has no public configuration fields and remains inert unless the document-start bridge exists.

```yaml
- name: '@deepseek-ai/dsh-client-ui-skill-library'
```

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The plugin treats `window.dshDesktopPluginBridge` (Swift) or `window.dshDesktop.skills` (Electron) as its capability signal, registers localized copy, then contributes one `sidebar.footer.action` entry and one `shell.overlay` entry through the existing slot registry. Catalog requests are projected through the typed bridge; the shell owns network access, bounded download, archive inspection, and filesystem changes.

| File | Role |
|---|---|
| [`src/client/index.ts`](src/client/index.ts) | Bridge gate, locale registration, and slot contributions |
| [`src/client/bridge.ts`](src/client/bridge.ts) | Typed SkillHub request/reply vocabulary |
| [`src/client/SkillLibraryOverlay.tsx`](src/client/SkillLibraryOverlay.tsx) | Filters, catalog rows, pagination, and download presentation |
| [`cordis.patch.yml`](cordis.patch.yml) | Portable composition row for the built-in Web profile |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Swift macOS desktop shell](../../../desktop-shell/README.md) — native bridge, lifecycle, and trust limits.
- [Electron desktop shell](../../../apps/desktop/README.md) — cross-platform bridge and packaged runtime.
- [UI slot system](../ui-slots/README.md) — typed additive registration used by the trigger and overlay.
- [Web application bundle](../../bundle/web-app/README.md) — composition that mounts this browser plugin.
- [Plugin settings](../ui-settings-plugins/README.md) — the companion package for external plugin management.

-----

<a id="model-experience"></a>
## Model Experience

### SkillHub catalog browsing

#### What the model sees

Nothing. The bundle contributes desktop UI only and does not register model tools, prompt text, or provider traffic; `window.dshDesktopPluginBridge` and `window.dshDesktop.skills` stay outside model context.

#### Token effect

None; catalog browsing and downloads happen outside model requests.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Bridge required** — a normal browser has no privileged desktop bridge, so the package does not register visible UI there.
- **Reviewed archives only** — shells reject oversized responses, invalid identifiers, symbolic links, excessive entries, archives without one Skill manifest, and duplicate install destinations.
- **SkillHub availability** — catalog results and downloads depend on SkillHub network availability and its response format.

No runtime invariant companion is published; catalog and installed-Skill state are read directly from the desktop bridge for each operation.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
