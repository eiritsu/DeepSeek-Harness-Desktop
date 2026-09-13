---
description: "The lightweight native macOS shell layer: authoritative SQLite sessions, DeepSeek Files, and external search providers over the shared Web application."
kind: "package-bundle"
---

# @deepseek-ai/dsh-desktop-lite

English | [中文](README.zh.md)

## Summary

This profile bundle is the final patch layer for the Swift/AppKit + WKWebView application. It keeps the official `dsh-base` and `dsh-web-app` composition, replaces JSONL Session persistence with `dsh-session-persistence-sqlite`, and mounts DeepSeek Files, external search providers, SkillHub, and Lark.

## Table of Contents

- [Composition](#composition)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

## Composition

The Lite shell and Electron shell point at `$DSH_HOME/desktop/dsh-desktop.sqlite`. They therefore see the same authoritative Session history when they use the same `DSH_HOME`. Production packaging must enforce one active desktop writer at a time.

This package contains configuration only. The native executable, packaging scripts, and compatibility target are documented in [`../../../desktop-shell/README.md`](../../../desktop-shell/README.md).

## Model Experience

### Desktop feature composition

#### What the model sees

The bundle adds the `lark_cli` tool and enables recognized attachment text and external Web provider results through their owning packages. It contributes no package-owned prompt text.

#### Token effect

Conditional. Tokens are added only when the user supplies recognized files, runs Lark or Web tools, or resumes persisted Session history.

#### KV Cache effect

The stable composed tool catalog is cacheable; per-Session history, attachments, and tool results extend the changing suffix.

## Known Limitations and Deferred Work

- The package is a private final patch layer for the Swift shell, not a general-purpose profile bundle.
- It does not enforce cross-process ownership itself; the Swift and Electron shells must acquire the shared desktop runtime lock before booting a Host.

No runtime invariant companion is published; this package is a static patch-list carrier whose mounted packages own their runtime relationships.

<a id="dev-note"></a>
### Dev Note

Keep this bundle configuration-only. Shared behavior belongs in the mounted capability and Client packages.
