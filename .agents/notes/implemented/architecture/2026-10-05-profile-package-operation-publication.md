# Agent Note: Publish profile package mappings at operation commit points

Status: implemented

English | [中文](2026-10-05-profile-package-operation-publication.zh.md)

## Problem

The Plugin Manager changes a profile's dependency manifest and bundle selection while its process stays alive. The runtime package table is process-local, so an installed bundle's private dependencies remain unavailable until the table is recomputed. Removing a mapping before the bundle's Loader entries stop also changes lookup for code that is still running.

The install dialog inspects one registry version before pnpm runs. pnpm can install a different version under `minimumReleaseAge`, but the manager previously returned no installed version and the dialog kept showing only the inspected version.

## Decision

### Runtime mapping publication

`ProfileRuntimeResolution` retains the installation anchor, Harness home, and profile directory used to build one immutable table. `PluginPackages.refresh()` recomputes a successor from those same locations and publishes it through `replace()`. A resolution supplied as plain data cannot be recomputed.

The resolver keeps installation mappings unchanged. It may remove profile mappings and local package names after their plugins stop. A retained profile mapping keeps its normalized directory, version, and scope, but may name another selected bundle as its declarer. The profile scope cannot change, a local name cannot override a mapped package, and a previously published link name cannot select another real directory. Publication replaces one generation and its caches; it does not unload modules or clear Node caches ([generation rules](2026-09-09-profile-resolution-generations.md)).

The Plugin Manager publishes a successful new installation after saving bundle selection and before loading its rows. An overwrite of an already installed package keeps the current table and reports `restart-required`. Enabling publishes before reload; disabling publishes after HMR stops the removed entries. Removal publishes after pnpm succeeds and after the affected entries stop. Failed and cancelled installations and failed removals do not publish.

Without HMR, disabling a bundle that started with the process leaves its entries running. While any startup bundle remains deselected, later package operations keep the current table. This preserves the mappings used by those live entries; package removal of a running startup bundle remains refused ([management lifecycle](2026-09-14-current-profile-plugin-management.md)).

### Installation result version

`ChangeResult.version` carries the installed bundle manifest's version when it declares one. The install dialog shows that version in the package card. When a registry subject has a known name and inspected version, pnpm asked only one registry, and the installed version differs, the dialog explains the pnpm `minimumReleaseAge` policy and gives the exact `name@version` spec to request the inspected version. A run that falls back to another registry makes no claim about why the versions differ. The install journey and its existing rollback behavior remain owned by [guided plugin installation](2026-09-15-guided-plugin-installation.md).

The compatibility baseline remains the `0.2.0-rc.2` Harness with its existing Cordis and independent-plugin dependencies. This backport changes runtime mapping publication and installed-version reporting without adopting the alpha release's unrelated source, API, or dependency changes.

## Alternatives considered

**Resolve directly from changed files on every lookup.** A new package path would become visible, but loaded module identities and live plugin state would still refer to the old package. The complete runtime table remains the authority for lookup.

**Publish before stopping a removed bundle.** A running plugin can make a later import after publication and observe a different package table. HMR therefore settles its removals before the manager publishes the successor.

**Report the inspected version as installed.** pnpm controls the resolved package version and may select another version under release-age policy. The result reports the installed manifest value, while the UI only explains a mismatch when one registry was asked.

## Testing

`packages/boot/app-boot/tests/profile-resolution.spec.ts` covers profile mapping removal and declarer changes while retaining installation restrictions. `profile-resolution-service.spec.ts` covers refresh of a computed installation-only resolution. `packages/boot/plugin-manager/tests/package-reload.spec.ts` drives install, enable, disable, removal, overwrite, failure, and cancellation through the real Loader with and without HMR. `manager.spec.ts` covers present and absent manifest versions. `packages/client/ui-plugin-manager/tests` cover result propagation and the one-registry mismatch notice.

## Consequences

Newly installed private dependencies become available before their bundle rows load, and removed mappings disappear only after the corresponding live entries stop. A table publication failure leaves a successful pnpm disk change in place and reports the application failure; it does not roll back installed packages. Existing modules and Workers retain their loaded package instances until they restart.

The optional `ChangeResult.version` field changes the pre-stable Plugin Manager Remote type. Its Typert/API projections and model-facing API catalog must be regenerated with the same source change. The backport adds no runtime dependency to app-boot; plugin-manager uses `chokidar` as a direct dev dependency for its file-watcher-isolated lifecycle tests.
