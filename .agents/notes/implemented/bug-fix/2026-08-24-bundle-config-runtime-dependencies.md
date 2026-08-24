# Agent Note: Keep bundle-config plugins in the runtime dependency closure

Status: implemented

English | [中文](2026-08-24-bundle-config-runtime-dependencies.zh.md)

## Problem

A Profile Bundle can insert a plugin only through `cordis.patch.yml`, so TypeScript import analysis does not observe the relationship. Removing that plugin from the bundle's production dependencies can leave source-plane tests green while a built desktop launch fails under plain Node. The profile module fallback only links packages reachable from the installed CLI dependency graph, and a missing config-only dependency therefore makes the Loader exit before the Web surface is ready.

## Decision

Every non-self bare package inserted by a Profile Bundle patch is a production dependency of that bundle. `verify-cordis-config` enforces the manifest relationship. A config-only dependency receives a package-scoped `knip` exception because the YAML reference, rather than a TypeScript import, is its runtime use.

The built Web CLI compatibility smoke starts the shipped profile from a fresh Harness home and verifies that the shared profile fallback contains the `Deepseek-Files` settings plugin before accepting startup. This exercises the same plain-Node resolution path used by the distributed macOS app.

## Alternatives considered

**Install default plugins into every user Profile.** Rejected because installation-owned bundles belong to the app dependency closure. Rewriting Profile dependencies would mix built-in packages with user-managed side-loaded plugins and require migration on each app upgrade.

**Declare the settings plugin directly on the CLI.** Rejected because the file-recognition bundle owns the plugin row and should carry every package required by its patch. Duplicating the dependency on the CLI would hide an invalid standalone bundle manifest.

## Verification

The Cordis configuration gate rejects a bundle patch whose non-self package is absent from its production dependencies. The built Web CLI compatibility smoke boots the complete shipped profile under plain Node and checks the generated module-fallback link for `@deepseek-ai/dsh-client-ui-deepseek-files`.

## Consequences

Existing Profiles keep their user dependencies and bundle order while app upgrades heal new built-in packages into the shared fallback. Config-only runtime dependencies require an explicit `knip` exception, paired with the Cordis configuration gate that proves why the exception exists.
