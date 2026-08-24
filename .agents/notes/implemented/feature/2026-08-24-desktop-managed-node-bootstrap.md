# Agent Note: Bootstrap a managed Node.js toolchain for the desktop app

Status: implemented

English | [中文](2026-08-24-desktop-managed-node-bootstrap.zh.md)

## Problem

The distributed desktop app builds its embedded source snapshot on first launch. Requiring every user to install Node.js manually makes the DMG incomplete, while embedding Node.js and the complete built workspace would substantially increase every download and duplicate runtime files after extraction.

## Decision

Desktop startup first accepts a same-directory `node` and `npx` pair when the Node.js version satisfies the repository engine range `^22.19.0 || >=24.0.0`. If no compatible pair exists, the app downloads the official Node.js 24.16.0 Darwin ARM64 archive, verifies a pinned SHA-256 digest, and installs it under `tools/node` in the application support directory.

Source preparation, runtime launch, update health checks, and plugin commands resolve the same toolchain. The managed installation does not require administrator access, modify shell configuration, or replace a system Node.js installation.

## Alternatives considered

**Embed Node.js and all built runtime dependencies in the DMG.** Rejected because the workspace dependency tree materially increases the disk image and is duplicated between the application bundle and extracted source cache.

**Install Node.js through Homebrew or a system package.** Rejected because it requires an external package manager, changes system state, and may require user approval unrelated to Harness.

**Accept any available Node.js executable.** Rejected because unsupported engine versions can fail during pnpm installation or runtime startup with diagnostics far removed from the actual prerequisite.

## Verification

Desktop tests prove that a compatible host toolchain skips installation, a missing toolchain installs a locally served archive after digest verification, an invalid digest leaves no managed installation, and the accepted versions match the repository engine range.

## Consequences

Users still need network access for the first source dependency installation and for downloading managed Node.js when no compatible host toolchain exists. Updating the pinned Node.js archive requires a desktop release that updates both its URL and digest.
