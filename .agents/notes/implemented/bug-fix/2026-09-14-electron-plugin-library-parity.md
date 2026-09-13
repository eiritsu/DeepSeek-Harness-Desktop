# Agent Note: Electron plugin-library parity

Status: implemented

English | [中文](2026-09-14-electron-plugin-library-parity.zh.md)

## Problem

Electron exposed a separate legacy plugin-management window that accepted only an npm package string and rendered none of the shared review, discovery, or audit experience used by Lite. The Windows build therefore appeared to have lost the plugin library. An installation could also leave the shared overlay indefinitely busy when the shell restarted before the request completed, and Lite's auxiliary SQLite mirror continued to label dependencies as installed after their profile manifest removed them.

## Decision

Electron now exposes the same `dshDesktopPluginBridge` consumed by `dsh-client-ui-plugin-library`. The sidebar action and application menu open one shared overlay. Electron implements installed and built-in inventory, npm update review, GitHub topic and SkillHub discovery, commit-pinned GitHub review, exact npm review, local-directory review, single-use review tokens, persistent audit records, and managed-profile install and removal.

The bridge accepts only validated structured requests. Remote manifests have response-size and redirect limits. Installable packages must name an existing package-internal `dsh.bundle.patch`; dependency lifecycle scripts stay disabled. Electron's profile accepts exact registry versions, full GitHub commits, and existing local-directory references, while still rejecting package-manager flags and host-owned packages.

Mutation replies complete before Electron schedules the application reload, and the shared overlay clears its busy state in `finally`. Lite's forced payload synchronization marks all profile-sourced plugin mirror rows removed before restoring dependencies observed in current manifests as installed.

## Alternatives considered

**Keep the Windows-only legacy window.** Rejected because it duplicated product behavior and permanently omitted source review, community discovery, audit history, and built-in inventory.

**Install arbitrary package-manager specifications.** Rejected because tags, branches, tarballs, and command-line flags do not provide an immutable reviewed source.

**Delete stale SQLite plugin rows.** Rejected because the auxiliary catalog is also an audit and migration inventory. A removed state preserves history without presenting the row as currently installed.

## Consequences

Swift and Electron, including Windows, present the same plugin-library client and keep shell-specific package execution behind narrow bridges. Built-in compatibility packages are visible but not removable. Failed operations become visible errors instead of permanent spinners, and successful operations reload the application only after the renderer receives completion.

The shared review is structural rather than a runtime sandbox. Plugins that depend on lifecycle scripts can still fail by design. Focused TypeScript, Electron, browser, and Swift tests cover request validation, immutable-source installation, menu opening, busy-state recovery, and stale mirror reconciliation.
