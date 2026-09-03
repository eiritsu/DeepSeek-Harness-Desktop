# Agent Note: Install workspace links before launching bundled source

Status: implemented

English | [中文](2026-09-02-bundled-source-dependency-install.zh.md)

## Problem

The distribution app unpacked built Harness artifacts and its lockfile but intentionally omitted `node_modules`. Source preparation returned early when `apps/cli/lib/bin.js` and the Web frontend were present, so the first launch attempted to import `@deepseek-ai/dsh-app-boot` before pnpm had created the workspace links and exited with `ERR_MODULE_NOT_FOUND`. The native launcher entry's generated JavaScript face was also absent from the snapshot, so the sandbox provider could fail after the initial dependency install.

## Decision

Source preparation now checks the CLI's `@deepseek-ai/dsh-app-boot` link when a lockfile is present. It runs the pinned frozen pnpm install for snapshots missing that link, then launches the existing artifacts without rebuilding them. Distribution packaging also copies the built native launcher entry face into the snapshot. Lockless test fixtures retain the previous artifact-only path.

## Alternatives considered

**Embedding `node_modules`:** rejected because machine-specific links make the distribution snapshot non-portable.

**Rebuilding on first launch:** rejected because a release must launch the verified artifacts without requiring local source compilation.

## Consequences

Fresh distribution installs bootstrap their workspace links before the first runtime launch, and the sandbox provider can resolve its native launcher entry. Developer trees with prepared links avoid an unnecessary install. The snapshot remains portable because it does not embed machine-specific `node_modules`.
