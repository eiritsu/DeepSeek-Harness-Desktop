# Agent Note: Physical Session deletion

Status: implemented

English | [中文](2026-09-29-physical-session-deletion.zh.md)

## Problem

Archive removes a Session from navigation but preserves its transcript. Users need a separate operation that removes the stored transcript itself without leaving a hidden copy, stopping work implicitly, or deleting data another Session may use.

## Decision

`WorkspaceRegistry.deleteSession(sessionId)` is the explicit irreversible operation. It reserves deletion against new Session Controller resolves, refuses Sessions reported active by `workspace/session-activity`, and never requests stop or cancel. The Session Controller retains the `AgentHandle` capabilities it creates; the owning handle atomically seals input and closes only when the Agent is idle with an empty Inbox. Unowned live Agents, active work, and queued input remain untouched and block deletion. JSONL persistence then claims the id locally, takes the same cross-process `session.lock` lease as writers, and unlinks canonical generation files oldest first with the highest generation last. It recognizes both supported filename encodings for deletion even though normal reads reject a mixed-encoding root. It does not recurse into directories, remove attachments, or cascade to fork children.

Format migration remains separate: it publishes an adjacent successor and retains predecessor generations. Only the explicit whole-Session `SessionPersistence.delete(id)` operation removes committed generations; migration and version/status rules never authorize deletion.

The JSONL provider leaves the empty per-Session directory and `session.lock` after success. POSIX locks refer to an inode, so removing the file would let a new writer lock a replacement inode while an older process still owns the original. The lock file contains no transcript data and is not a visible Session generation.

After physical deletion, the registry detaches Workspace memberships and removes archive and pin references, then clears its cached header and emits `workspace/session-deleted`. The API relays this as `api-session/removed` for an open Client Session; Workspace feeds receive the registry changes. Query indexes reconcile persisted identities against fresh persistence listings before serving queries. Children retain their original `parentSession` metadata and their own generations.

If an unlink fails before the highest generation is removed, that generation remains readable. If physical removal fails after an owned idle Agent closes, its admission reservation is released and a later operation may resume the still-persisted Session. After the highest generation is unlinked, the reservation becomes a tombstone even if Workspace reference cleanup fails; retrying the same id treats missing storage as an already completed physical step, retries reference cleanup, and republishes the event. If an event listener throws, some listeners may already have received the event. A directory-sync failure may therefore produce an error response after transcript bytes are gone; the RPC does not claim success until registry cleanup and event publication finish.

## Alternatives considered

**Archive as deletion.** Archive is reversible navigation state and preserves the transcript; presenting it as delete would leave the exact hidden data users expect removed.

**Stop active work during delete.** Deletion must not silently cancel user work. The active refusal lets the caller ask the user to stop first, while the persistence lock independently rejects writers in another process.

**Remove the session directory and lock file.** Deleting the lock inode permits cross-process writer exclusion to split across old and replacement inodes. The harmless empty directory is retained until a future design proves safe directory reclamation.

**Cascade to fork children or shared attachments.** A child owns its own transcript and may remain useful after its source is deleted; attachments can be shared. The operation removes only generation files in the target id's owned directory.

## Consequences

Deletion is irreversible for every generation that is successfully unlinked. A crash or I/O error can leave older generations partially removed, but the highest is removed last; retry completes the operation. A process crash after the highest unlink but before directory sync can leave filesystem durability dependent on the platform. Metadata cleanup is idempotent across retries, and the retained lock inode keeps same-id coordination stable.

Focused persistence, real AgentLoop/JSONL Host, registry, RPC, and Client tests cover physical bytes, lock ownership, active and queued-work refusal, idle current-Agent teardown, fork-child survival, references, retry, and removal events. Keyless session snapshots describe model-visible replay and cannot represent a control-plane deletion or filesystem mutation; this feature changes no model input or Session event, so the focused tests are the acceptance evidence.
