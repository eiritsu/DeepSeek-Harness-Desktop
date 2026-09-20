---
description: "Build, run, and package DeepSeek Harness Lite, the native AppKit and WKWebView macOS shell over the shared upstream Node host."
kind: "app-guide"
---

# DeepSeek Harness Lite for macOS

English | [中文](README.zh.md)

DeepSeek Harness Lite is the low-memory native alternative to the Electron application in [`../apps/desktop`](../apps/desktop). It embeds the same current Web client in `WKWebView` and launches the official `dsh` Node host with the shipped `desktop-lite` profile. Product behavior remains in shared TypeScript packages; Swift owns only macOS lifecycle, WebView integration, source updates, downloads, and native file dialogs.

The transparent titlebar hides its native title and uses only the static brand area for window dragging, leaving the Web toolbar and sidebar tab controls available to `WKWebView` click targets.

## Compatibility

The package and application plist target macOS 11.0 through macOS 26 on Apple silicon. Downloads use the native `WKDownload` path on macOS 11.3 and later; the rest of the shell remains available on 11.0–11.2. Development requires Swift 6, Node.js `^22.19.0 || >=24.0.0`, Git, and `rsvg-convert` from librsvg.

The Electron application targets macOS 13 through macOS 26 because its Electron runtime no longer supports macOS 11 or 12. Both products are arm64 builds with different names and bundle identifiers:

| Product | Bundle identifier | Output |
|---|---|---|
| Lite development | `ai.deepseek.harness.desktop.lite.local` | `desktop-shell/dist/DeepSeek Harness Lite.app` |
| Lite isolated test | `ai.deepseek.harness.desktop.lite.isolated` | `desktop-shell/dist-isolated/DeepSeek Harness Lite Isolated.app` |
| Lite distribution | `ai.deepseek.harness.desktop.lite` | `desktop-shell/dist/DeepSeek-Harness-Lite-macOS.dmg` |
| Electron | Electron package identifier | output owned by `apps/desktop` |

## Shared data and preserved features

The production Lite shell uses `~/.dsh` as `DSH_HOME`, matching Electron and the CLI. The isolated test build uses `~/Library/Application Support/DeepSeek Harness Lite Isolated/data` and never reads or migrates `~/.dsh`. The `desktop-lite` and Electron compositions both use `$DSH_HOME/desktop/dsh-desktop.sqlite` as authoritative Session persistence. This preserves Session history, Session IDs, cross-Session references, attachment metadata, and SQLite migration behavior across shells. Both profiles mount DeepSeek Files recognition, external-search provider settings, SkillHub, the native plugin library, Lark, and `dsh-model-catalog`. The model catalog refreshes complete upstream declarations from `models.dev` and enriches discovery and actual calls without creating an implicit provider route.

The Swift shell keeps its source/update audit catalog under `~/Library/Application Support/DeepSeek Harness Lite`; that auxiliary database is not Session authority. A newer application build activates its embedded source snapshot before consulting an older managed release, while the build identity prevents an older application copy from replacing source installed by a newer build. Runtime maintenance and application shutdown hide the WebView before stopping the Host, so the composer cannot submit into a retiring process. Forced profile synchronization marks dependencies absent from current manifests as removed, so its plugin inventory does not report stale installations. First launch can migrate data from the previous `~/Library/Application Support/DeepSeek Harness Desktop/data` location without deleting the old directory.

The `dsh web:` startup line is the shell's readiness signal: the Web profile emits it only after plugin loading has settled and the local server is available. Lite navigates once after that signal instead of probing a private plugin route. When legacy migration copies `.credentials.yaml`, Lite narrows its permissions to `0600`; malformed credential files still fail startup, but the failure screen identifies the file and recovery action without displaying credential values.

Configuration export is desensitized: credentials, Session transcripts, attachment bytes, logs, and machine identity are excluded. Import merges profiles and Skills, restores settings without replacing the authoritative Session database, migrates the legacy `llm-dsh-ai` namespace to `llm-pi-ai`, and carries old Web-profile third-party plugins into `desktop-lite`. Reset stops the Node runtime before clearing owned data. Packaging must enforce a single active desktop writer before both shells are distributed together.

## Develop

From the repository root:

```sh
swift test --package-path desktop-shell
desktop-shell/scripts/build-app.sh
open "desktop-shell/dist/DeepSeek Harness Lite.app"
PATH="/opt/homebrew/bin:/opt/homebrew/sbin:$PATH" desktop-shell/scripts/build-app.sh --isolated
open "desktop-shell/dist-isolated/DeepSeek Harness Lite Isolated.app"
```

Create the distribution DMG only from a clean, published release commit:

```sh
desktop-shell/scripts/package-dmg.sh
```

The distribution embeds the current repository source and built runtime artifacts, removes developer paths and repository-only material, generates `AppIcon.icns`, and applies an ad-hoc signature. Notarization and Developer ID signing remain release work.
