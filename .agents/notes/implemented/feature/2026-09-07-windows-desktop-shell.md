# Agent Note: Windows desktop preview shell

Status: implemented

English | [中文](2026-09-07-windows-desktop-shell.zh.md)

## Problem

The desktop fork originally had only a Swift macOS shell. Windows users needed an executable preview that reused the Web application without creating a second product UI.

## Decision

`desktop-shell-windows` implements the fork's early Windows preview with Electron context isolation and a Chromium renderer. It starts the built `dsh --profile web` runtime, loads its loopback URL, and keeps directory selection and external navigation in the host process. Product UI, MCP configuration, plugin management, credentials, and tool priority remain in the shared Web application.

The current upstream production Desktop now lives in `apps/desktop` and `apps/desktop-host`; it does not use this preview shell. The [desktop-fork Electron migration proposal](../../proposed/architecture/2026-09-13-desktop-fork-electron-migration.md) owns retirement and feature mapping.

## Alternatives considered

**Build a native Windows UI.** That would duplicate the Web interface and make platform behavior diverge further from the Swift macOS shell.

**Wait for the macOS shell to become portable.** Swift AppKit and WebKit do not provide a Windows runtime, so this would not produce a Windows preview.

## Consequences

The fork obtained a Windows preview from the same Web UI, but the preview retained the loopback server, source deployment, and a separate packaging path. It is historical migration input, not the production Desktop architecture or a qualified release target.
