# Agent Note: Normalize SkillHub archives and validate catalog requests

Status: implemented

English | [中文](2026-09-03-skill-archive-and-catalog-request-validation.zh.md)

## Problem

SkillHub skill archives can contain nested `references/` and metadata files. Copying archive entries directly into the shared skill root made those files look like independent installs and caused later downloads to fail with a false “already exists” error. The SkillHub plugin endpoint currently accepts only the `stars` sort, while the desktop UI exposed additional values that returned HTTP 400.

## Decision

The desktop installer resolves either a root-level or one-directory-wrapped `SKILL.md` payload, ignores both SkillHub metadata filenames, stages the complete payload, and moves it atomically into `data/skills/<slug>`. Installed-skill listing includes both legacy root payloads and normalized child directories. The plugin discovery request and UI expose only the server-supported `stars` sort, and native code falls back to it for stale clients.

The distribution packaging script rejects a client artifact record that is not the official profile with the DeepSeek Harness title. This prevents a local-development Web bundle from being embedded in a release DMG.

## Alternatives considered

**Delete the existing skill root before downloading.** This would discard user data and would not fix the archive-layout defect for future installs.

**Copy every archive entry into a unique flat prefix.** A prefix would avoid collisions but would leave the runtime with an ambiguous skill layout and would not preserve the archive's own directory relationships.

**Keep unsupported plugin sort tabs and retry after HTTP 400.** Retrying the same invalid request adds delay without producing a different result; the UI now reflects the API contract instead.

**Trust the caller to build official artifacts before packaging.** A release process that accepts a stale local build can publish a broken app, so the package script now checks the recorded profile and title.

## Consequences

New SkillHub downloads preserve `references/`, hooks, and other payload directories under one slug directory. Existing flat installs remain readable and are not deleted; a repeated slug reports a clear slug-level conflict. Plugin discovery no longer displays sort controls that the current service rejects, and old clients receive a safe native fallback. Distribution packaging fails early when Web artifacts were built with the local profile.

Focused native tests cover wrapped and metadata-only Skill archives, and the existing catalog test now asserts the server-supported sort value. A complete official client build is required before the next DMG is produced.
