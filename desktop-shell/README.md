# DeepSeek Harness Desktop for macOS

English | [中文](README.zh.md)

DeepSeek Harness Desktop embeds the official `dsh web` application in WKWebView while keeping the Harness runtime, profiles, Cordis composition, settings, and session data in their existing owners. The Swift shell adds native process lifecycle, single-instance protection, session-selection continuity across random loopback ports, source update and rollback, standard Edit shortcuts, external-link routing, and a reviewed installer for sideloaded Profile Bundles.

<p align="center"><img src="Resources/AppIcon.svg" width="112" alt="DeepSeek Harness Desktop icon"></p>

This is a local developer-preview build. It is ad-hoc signed, is not distributed through the Mac App Store, and may require rebuilding when the upstream Web application changes.

## Desktop behavior

- **Runtime lifecycle.** The application holds an advisory lock for its Application Support directory, starts the repository-built CLI with `--profile web --no-open --port 0`, and opens the announced loopback URL in WKWebView. A second application copy activates the existing process instead of starting another runtime against the same data.
- **One-time Web authentication.** The CLI readiness line includes a one-time token. WKWebView performs the first request so it can exchange that token for its origin cookie; reloads use the same URL without query or fragment and therefore never reuse the token.
- **Session continuity.** A document-start bridge restores the opaque current-session selection from native preferences and mirrors later selection changes. Session logs, drafts, settings, and plugin state remain owned by Harness.
- **Native presentation.** The standard Edit menu follows the AppKit responder chain, external links open in the default browser, and a transparent title bar preserves a drag region outside sidebar controls.
- **Plugin review.** The desktop-only Plugin library discovers public projects, pins network sources, inspects Bundle structure, delegates approved mutations to `dsh plugin --profile web`, and writes a JSONL audit log. A normal browser mounts the same client package but exposes no native bridge, so no Plugin library UI is registered.
- **Startup recovery.** If one sideloaded Bundle prevents readiness, the shell may retry once with a temporary profile that omits only that out-of-tree dependency. It does not edit the Web profile or uninstall the package.

The Web profile accepts current plugins and the supported previous external-plugin generation together. A compatibility client entry forwards the former snapshot-store and settings imports to their current owners; transient file recognizers can convert supported generic files to logged text without making them durable attachments; and the LLM service accepts both current exact-route metadata enrichers and previous discovery, modality, and capacity registrations. The profile mounts local `Deepseek-Files`, Office recognition, Lark, and model-catalog Bundles beside current Web Search and Skin Center Bundles.

## Source updates and rollback

The updater fetches the configured `origin` branch and accepts only a fast-forward from the active source. A local checkout that already contains the remote commit is left unchanged. If local desktop commits and upstream have diverged, automatic update stops with a diagnostic instead of replacing local behavior; integrate the upstream branch in the repository first, rebuild, and then launch the new source.

A safe fast-forward is prepared in a detached Git worktree. The shell installs the unchanged lockfile, builds the repository, starts the staged CLI with separate probe data, exchanges its one-time authentication token, and requires HTTP 200 before switching the active source pointer. The previous pointer remains available for rollback. Rollback changes source selection only and cannot reverse a persisted-data migration.

## Plugin source review

Review accepts an exact npm version, an HTTPS GitHub repository pinned to a commit, or a local directory. Direct installation requires a valid root package manifest whose `dsh.bundle.patch` names an existing package-internal YAML entry. Network and local sources pass the same structural checks immediately before installation; a review token is single-use and expires after 15 minutes.

GitHub's `dsh-plugin` topic and deepseek1024.com are separate, untrusted discovery indexes. Catalog presence is not an endorsement or an installation decision. The native reviewer resolves an immutable source before installation and rejects malformed, mutable, or structurally incompatible candidates.

Installation forces exact saving and disables dependency lifecycle scripts. These checks reduce installation-time risk but do not sandbox an activated plugin; third-party code can use the file, network, process, and credential access granted by its Harness composition.

## Build and run

Requirements are macOS 13 or newer, Swift 6, Node.js `^22.19.0 || >=24.0.0`, Git, `rsvg-convert` from librsvg, and network access for the first dependency installation. From the repository root:

```sh
npx --yes pnpm@11.7.0 install --frozen-lockfile
npx --yes pnpm@11.7.0 run build
desktop-shell/scripts/build-app.sh
open "desktop-shell/dist/DeepSeek Harness.app"
```

The build script recreates `desktop-shell/dist/DeepSeek Harness.app`, generates `AppIcon.icns`, applies an ad-hoc signature after all resources are present, and records the current checkout as the initial source root. The resulting application has the development bundle identifier `ai.deepseek.harness.desktop.local`.

Run `desktop-shell/scripts/package-dmg.sh` to create a shareable disk image. The distribution build removes the developer source path, embeds a source snapshot assembled from tracked files, and uses the `ai.deepseek.harness.desktop` identifier. It remains ad-hoc signed and is not notarized.

If no existing `node` and same-directory `npx` satisfy the required version, startup downloads the official Node.js 24.16.0 ARM64 archive, verifies its pinned SHA-256 digest, and installs it below Application Support without administrator access or changes to the system Node.js installation.

## Data and logs

Sessions, settings, credentials, profiles, plugin dependencies, managed source versions, and desktop logs live below:

```text
~/Library/Application Support/DeepSeek Harness Desktop/
```

Harness data is stored in the `data` subdirectory and stays separate from source worktrees and the application bundle. Desktop runtime output and native errors are appended to `logs/desktop.log`; plugin review and mutation records are appended to `logs/plugin-audit.jsonl`.

## Security limits

The Web UI listens only on `127.0.0.1`, and the shell accepts navigation privileges only for its main-frame loopback page. The desktop executable does not enable the macOS App Sandbox because it must start Node.js, Git, the package manager, and agent subprocesses and must access user-selected workspaces. Harness tool sandboxing remains whatever the Web profile composes; it does not confine plugin processes or the desktop executable itself.
