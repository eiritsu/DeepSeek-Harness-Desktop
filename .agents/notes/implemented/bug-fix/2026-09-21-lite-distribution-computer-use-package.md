# Agent Note: Lite distribution enumerates the Computer Use client package

Status: implemented

English | [中文](2026-09-21-lite-distribution-computer-use-package.zh.md)

## Problem

The `desktop-lite` profile mounts `dsh-client-ui-computer-use` as the Computer Use settings section, but the Lite distribution lists named only the native provider and the shared service. The RuntimeManifest therefore recorded no package entry or artifact hash for the client package, and `package-dmg.sh` did not audit its presence in the source snapshot. An installation could omit the settings section even though the profile declared it. The Swift shell's own inventories had the same gap: a source update would replace the staged package with an upstream tree that lacks it, the plugin inventory omitted it, and profile cleanup would write the client-only name into `dsh.profile.bundles`, which the host loader rejects.

## Decision

[`build-app.sh`](../../../../desktop-shell/scripts/build-app.sh) lists `packages/client/ui-computer-use` in `packagePaths`, so the RuntimeManifest records the package and hashes its built `lib`, and in the built-artifact check, so packaging fails when it is unbuilt. [`package-dmg.sh`](../../../../desktop-shell/scripts/package-dmg.sh) audits the same path in the source snapshot before creating the DMG. The snapshot's generic `lib` copy already carried the built artifacts; the explicit lists make an omission fail the build.

The Swift shell lists the same package in all three of its inventories. `SourceManager.managedExtensionPaths` carries `packages/client/ui-computer-use`, so [`SourceManager.swift`](../../../../desktop-shell/Sources/DeepSeekHarnessDesktop/SourceManager.swift) copies the application-owned package over the staged update tree. `PluginManager.clientOnlyBundleNames` carries `@deepseek-ai/dsh-client-ui-computer-use`, which is both the embedded inventory that [`PluginManager.swift`](../../../../desktop-shell/Sources/DeepSeekHarnessDesktop/PluginManager.swift) reports as app-managed and the cleanup list that `ensureManagedProfile` strips before writing `dsh.profile.bundles`.

## Alternatives considered

**Rely on the generic `lib` copy alone.** The snapshot copies every package `lib`, but the RuntimeManifest and DMG audit read explicit lists, so an unbuilt or absent client package would not fail packaging. The Swift overlay likewise copies only listed paths, so an upstream tree without the package would drop it from the updated source.

**Derive the lists from the `desktop-lite` profile.** The existing lists also name base-bundle packages that the profile does not mount, so deriving them from the profile would change which packages are recorded and audited.

**Keep separate embedded and cleanup Swift lists.** Both entries describe the same client-only roster, and the cleanup list previously disagreed with the embedded one only by omission. One `clientOnlyBundleNames` array feeds both, so adding a client feature cannot update one list and miss the other.

## Verification

A focused spec in [`packages/bundle/desktop-lite/tests/distribution-packages.spec.ts`](../../../../packages/bundle/desktop-lite/tests/distribution-packages.spec.ts) asserts that the profile mounts `@deepseek-ai/dsh-client-ui-computer-use` and that all three script lists name `packages/client/ui-computer-use`.

[`desktop-shell/Tests/DeepSeekHarnessDesktopTests/ComputerUseInventoryTests.swift`](../../../../desktop-shell/Tests/DeepSeekHarnessDesktopTests/ComputerUseInventoryTests.swift) pins the Swift lists through narrow internal seams: `SourceManager.overlayManagedExtensionPaths` and `overlayManagedExtensionsForTesting` drive the real overlay over a fixture tree, and `PluginManager.clientOnlyBundleInventory` backs both an inventory assertion and a profile-cleanup assertion that the name never reaches `dsh.profile.bundles`.

## Consequences

A Lite distribution now fails packaging when the Computer Use client package is missing or unbuilt, and its RuntimeManifest package record matches the profile it ships. A source update preserves the app-owned package, the plugin inventory presents it as built-in and non-removable, and cleanup cannot write it as a profile bundle.
