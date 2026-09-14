# Agent Note: Preserve Desktop compatibility extensions

Status: implemented

English | [中文](2026-09-13-desktop-compatibility-extensions.zh.md)

## Problem

Rebasing Desktop onto the upstream Electron baseline removed the dynamic model catalog and native plugin-library packages. The Swift configuration importer also treated a scrubbed legacy database as the live Session database and replaced whole profile and Skill directories. This lost current Session state, failed to activate old `llm-dsh-ai` provider settings, and removed current built-in or third-party profile entries.

## Decision

Both Desktop profiles mount `@deepseek-ai/dsh-model-catalog` and disable the implicit `llm-deepseek` route. The catalog keeps a last-good persisted `models.dev` snapshot and supplies authoritative discovery metadata plus runtime input, capacity, and reasoning facts. An opaque gateway route uses the smallest capacity plus shared input modalities and reasoning levels across exact same-ID declarations instead of falling back when providers express equivalent limits with different units; provider-specific extras never combine. `llm-pi-ai` asks the catalog only when a model entry does not explicitly declare the corresponding modalities or reasoning levels; explicit route configuration remains authoritative. Prepared calls apply the same effect-scoped metadata chain as standalone model inspection.

Swift Lite also mounts `@deepseek-ai/dsh-client-ui-plugin-library` and embeds both restored packages in its managed source set. Its configuration importer preserves the live Session SQLite database, merges profiles and Skills, maps legacy `llm-dsh-ai` settings to `llm-pi-ai`, and carries only third-party dependencies and Bundles from the old Web profile into `desktop-lite`. Export uses SQLite's backup operation before redaction and includes the non-secret settings file. Imported settings are written with owner-only permissions.

Both Desktop profiles continue to mount `@deepseek-ai/dsh-file-recognizer-office`. A PDF without locally extractable text is rasterized into bounded page PNGs before its OCR fallback, because configured image OCR endpoints need not accept Chat Completions `file` content. The shared attachment UI retains browser drops and consumes Swift's `dsh:native-drop` event: bounded files enter the upload path, while directories and files above the bridge limit become composer path references.

## Alternatives considered

**Use only pi-ai's bundled catalog.** This stays offline and smaller, but it freezes model declarations at the application dependency version and recreates the metadata regression the Desktop fork had already solved.

**Replace current data with the legacy export.** This reproduces the old importer, but a configuration archive intentionally contains a scrubbed database and cannot be authoritative for Session recovery. Merging configuration while leaving Session restoration separate preserves both data sets.

## Consequences

Desktop starts without a default provider card, but a configured route receives current upstream model declarations without rewriting user settings. An opaque gateway may receive a lower limit than its actual provider supports, but it never receives more than any exact same-ID catalog route declares. A failed catalog refresh retains last-good data and then falls back to pi-ai for uncovered fields. Legacy configuration recovery no longer acts as a Session restore; Session backup and restore remain separate operations over the authoritative database. Plugin files and current profile entries survive a configuration import.

## Verification

Focused tests cover catalog refresh, discovery and prepared-call enrichment, conservative same-ID capacity resolution, explicit modality precedence, package disposal, configuration namespace migration, profile and Skill merging, Session database preservation, `0600` settings permissions, scanned-PDF page OCR, and native drag intake. A configured real OCR endpoint recognizes every page of the reported two-page PDF after rasterization. Desktop packaging audits require all restored packages in the embedded runtime.
