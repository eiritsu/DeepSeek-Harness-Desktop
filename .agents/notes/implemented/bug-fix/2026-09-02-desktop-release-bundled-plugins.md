# Agent Note: Desktop release bundles the verified local runtime and self-developed plugins

Status: implemented

English | [中文](2026-09-02-desktop-release-bundled-plugins.zh.md)

## Problem

## Decision

The macOS distribution build now takes the sibling DeepSeek Plugin checkout explicitly, copies the five runtime/client package faces and their built artifacts, regenerates the snapshot lockfile, and adds those packages to the CLI installation anchor. Its release-only Web profile template enables the Plugin library, Deepseek-Files Office recognition, Lark, model-catalog, and SkillHub bundles, so a new installation does not depend on a user-local profile or absolute `file:` dependency.

The packaged source snapshot carries the verified CLI and Web artifacts and excludes Git metadata, tests, snapshots, source maps, governance files, and development-only documentation. Build-time audits reject missing plugin packages, builder paths, private keys, and a release profile that does not mount every bundled plugin. The app metadata points source updates at the local adaptation branch containing the session-persistence injection fix.

## Alternatives considered

**Ship plugins separately:** rejected because the desktop release must work immediately after installation with the verified first-party extensions.

**Use user-local profile paths:** rejected because absolute paths are not portable and can load unreviewed local code.

## Consequences

The DMG packaging smoke installs the snapshot with the frozen lockfile, confirms the CLI can start, and verifies the generated Web profile resolves all bundled layers.
