---
description: "SQLite session persistence for the desktop database and maintainers configuring durable event logs."
kind: "package-reference"
---

# @deepseek-ai/dsh-session-persistence-sqlite

English | [中文](README.zh.md)

`dsh-session-persistence-sqlite` stores each session header and its contiguous `SessionEvent` rows in one SQLite database. It uses the shared persistence coordinator, so session creation, append ordering, resume preparation, crash closers, revisions, and deletion have the same semantics as the JSONL backend while the desktop database remains the single durable medium.

## Summary

The backend keeps the logical session stream in SQLite rows and uses the shared coordinator for lifecycle and write ordering. Choose it when a desktop deployment needs one owner-controlled database instead of one artifact per session.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

## Use this package

Mount the backend in the desktop profile. It registers `ctx.sessionPersistence` and keeps the old JSONL files as a rollback source during the one-time import.

## Configuration

```yaml
- id: session-persistence-sqlite
  name: '@deepseek-ai/dsh-session-persistence-sqlite'
  config:
    path: /path/to/dsh-desktop.sqlite
    legacyRoot: /path/to/legacy/sessions
```

`path` is required. When `legacyRoot` is set, existing JSONL sessions are imported once before the first SQLite read; the import marker is stored in SQLite and later starts are idempotent. The backend creates the parent directory, enables WAL and full synchronous commits, and restricts the database file to the owner on POSIX filesystems.

## Understand the implementation

The shared `PersistenceCoordinator` owns batching, sequence checks, crash closers, and lifecycle disposal. This provider owns the SQLite schema, transactions, revisions, and the idempotent legacy importer.

## Further Exploration

- [Session persistence service](../session-persistence/README.md)
- [Desktop data migration note](../../../.agents/notes/implemented/architecture/2026-09-03-desktop-application-support-data-and-plugin-management.md)

## Model Experience

### Session restoration

#### What the model sees

SQLite does not add prompt content or model-visible fields. The model receives the same reconstructed session events and request metadata from `ctx.sessionPersistence` after a restart; SQLite is an implementation detail.

#### Token effect

Zero additional tokens are introduced by the storage backend.

#### KV Cache effect

The backend does not alter request prefixes, so cache reuse follows the selected model provider's normal rules.

## Known Limitations and Deferred Work

- The backend exposes a reconstructed JSONL view for export through `readRaw`; the SQLite rows remain authoritative. It does not provide a separate per-session artifact path. Legacy import intentionally leaves the original JSONL files untouched so rollback remains recoverable.

<a id="dev-note"></a>
### Dev Note

The desktop migration mirrors settings, credentials, workspace, profile, plugin, skill, and model-catalog payloads into SQLite. Sessions, settings, credentials, and storage units now use the database at runtime; profile, Skill, plugin-audit, and source-release owners still retain file compatibility while their transactional migrations are completed.
