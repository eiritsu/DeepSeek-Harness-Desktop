---
description: "SQLite Session persistence for desktop deployments that need one authoritative database, transactional appends, cheap listing metadata, and backup-friendly storage."
kind: "package-reference"
---

# @deepseek-ai/dsh-session-persistence-sqlite

English | [中文](README.zh.md)

## Summary

`dsh-session-persistence-sqlite` stores Session headers and events in one SQLite database. It commits each event batch and its count in one transaction, keeps the database in WAL mode with full synchronization, and exposes the same handle API as the JSONL provider. Choose it for a desktop profile that needs one authoritative, backup-friendly store and does not require a separate file for every Session.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount this provider after the Session service and give it one database path. A composition must mount exactly one `SessionPersistence` provider.

```yaml
- name: '@deepseek-ai/dsh-session'
- name: '@deepseek-ai/dsh-session-persistence-sqlite'
  config:
    path: /absolute/path/to/sessions.sqlite
```

| Field | Default | Meaning |
|---|---|---|
| `path` | required | SQLite database file; `:memory:` is intended for tests |

A new Session remains process-local until its first event batch or explicit `flush`. The first durable write inserts its header and events in one transaction. Later appends verify the stored next sequence, insert a contiguous batch, and update `event_count`, `revision`, and `updated_at` before the transaction commits. `stat` and `list` read the stored count without loading event bodies.

The backend creates missing parent directories and database files with owner-only permissions. It enables foreign keys, WAL journaling, and `synchronous=FULL`. Schema version `1` adds lineage, count, and revision columns to the unstamped desktop schema before stamping `PRAGMA user_version`.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The provider owns one `DatabaseSync` connection. Metadata rows hold the immutable Session header, inherited prefix length, event count, and revision. Event rows use `(session_id, seq)` as their primary key and cascade-delete with metadata. Each write handle serializes explicit appends and routed live-event drains on one promise chain; the service routes `session/event`, `session/flush`, and `session/disposed` to the current writer for that Session id.

Reads parse the durable JSON, check the requested id and current Session format version, require contiguous row and payload sequence numbers, and run the shared fail-closed event validator. Returned event graphs are deep-frozen before the handle reports `shared-frozen` ownership.

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Schema setup, backend service, Session handle, live-event routing, and teardown |
| [`tests/sqlite.spec.ts`](tests/sqlite.spec.ts) | Shared persistence/live-write contracts and SQLite metadata coverage |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Session persistence subsystem](../../../docs/subsystems/persistence.md) — provider-neutral handle, durability, and recovery semantics.
- [Session persistence seam](../session-persistence/README.md) — the API implemented by this provider.
- [JSONL provider](../session-persistence-jsonl/README.md) — the per-Session-file alternative with released-format migration.

-----

<a id="model-experience"></a>
## Model Experience

### Resumed conversation history

#### What the model sees

SQLite contributes no prompt text. A resumed lifecycle reconstructs the same validated `SessionPersistence` events exposed by any conforming persistence provider.

#### Token effect

Zero live-request tokens beyond the restored conversation history and current request envelope.

#### KV Cache effect

Storage choice does not change request prefixes. Cache reuse depends on reconstructed history, the current envelope, and the selected model route.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Only installed migrations are accepted** — the provider upgrades the recognized legacy desktop schema and released Session formats through the format catalog, but refuses unknown layouts and newer formats.
- **One writer is enforced per backend instance** — a second write handle in the same Host rejects. Cross-process exclusion belongs to the application; both desktop shells use `$DSH_HOME/desktop/runtime.lock` before starting a Host.
- **Deletion is transactional** — `delete(id)` refuses an active writer and deletes the metadata row inside `BEGIN IMMEDIATE`; foreign-key cascade removes its events before commit.
- **WAL creates companion files** — a backup operation must checkpoint and close the Host before copying the database; copying only the main file while it is live can omit committed pages.

No runtime invariant companion is published; durable reads validate the authoritative database directly, and focused persistence contracts own transaction and lifecycle behavior.

<a id="dev-note"></a>
### Dev Note

The dual desktop shells now own a shared process-lifetime lock, released Session-format migration, and closed-Host backup/import flows. Packaged oldest/newest-platform qualification remains release work.
