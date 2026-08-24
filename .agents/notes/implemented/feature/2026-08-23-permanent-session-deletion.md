# Agent Note: Permanent Session deletion across durable and derived state

Status: implemented

English | [中文](2026-08-23-permanent-session-deletion.zh.md)

## Problem

Archive hides a Session without changing its log or Workspace accounting, but users also need an explicit permanent-delete operation. Removing only the primary log would leave Workspace ledgers, the archive set, content-search rows, and message-feedback sidecars referring to an identity that no longer exists. Deleting a live or parent Session without one ownership rule could also race final persistence or strand descendants.

## Decision

`SessionPersistence.delete(id)` is the durable authority. It rejects a live Session, serializes behind earlier work for that id, invalidates preparation state, cancels an unmaterialized lazy create intent without creating an artifact, and delegates materialized removal to the backend. JSONL removes the transcript and empty Session directory with a POSIX parent-directory fsync; SQLite removes the Session row and cascading events in one transaction. Success emits `session-persistence/deleted` only after the identity has left the persistence view.

The Host `session.delete` operation owns product orchestration. It builds the complete descendant set from live and persisted headers, rejects a non-recursive parent delete, preflights every target before mutation, rejects any running target, disposes only Agents whose handles this gateway owns, and deletes descendants before ancestors. A newly created blank Session has no durable artifact after disposal; the Host treats that known transient identity as successfully deleted and emits the same cleanup event. Recursive retries tolerate a descendant already removed by an earlier partial attempt.

Derived owners subscribe independently. Workspace removes the id from header/path indexes, every Session account, and the archive set; session-query reconciles its disposable SQLite index; message-feedback queues removal of the lifecycle sidecar behind already accepted mutations. The persistence layer does not import any derived package.

The Workspace browser exposes Copy Session ID, Archive Session, and Delete Session as distinct actions, including on the blank Session row. Delete uses an explicit permanent-action confirmation and requests recursive deletion; a failure leaves the dialog open. Copy writes the opaque `SessionId`, while archive remains non-destructive and immediately hides the row.

## Alternatives considered

**Use archive as the only removal action.** Archive is reversible in data terms and preserves accounting, but it does not satisfy a request to erase the Session log and related local records. Keeping both actions makes that difference explicit.

**Cancel a running Session automatically.** Rejected because cancellation and permanent deletion are separate destructive decisions, and cancellation may still be settling tool effects and final durability. The caller stops the run first, then deletes.

**Cascade from Workspace deletion.** Rejected because a Workspace registration does not own its directory or Session logs. Workspace deletion continues to move retained Sessions to Ungrouped; only the Session action deletes Session state.

**Let each backend clean derived data.** Rejected because it reverses dependency direction and cannot cover optional consumers. One post-delete event keeps the durable authority narrow and lets rebuildable projections own their cleanup.

## Consequences

Deletion is immediate and has no trash or undo window. Content-addressed attachment objects remain under the attachment backend because they can be shared and no reference-aware garbage collector exists; the deleted Session log no longer references them. Preflight prevents ordinary partial deletion when a target is live or externally owned, but the multi-owner cleanup is not a cross-store transaction: a process crash can interrupt descendant deletion or a derived subscriber. A repeated recursive request converges primary storage, Workspace state self-prunes missing ids, and session-query is rebuildable; out-of-band storage removal still emits no event and may leave guarded sidecars.

The shared persistence contract runs against JSONL and SQLite for materialized, unknown, reused, and lazy identities. Coordinator coverage pins live-owner refusal and event timing; Host coverage pins blank deletion, running refusal, and recursive leaf-first behavior; UI coverage pins the three menu actions and permanent-delete presentation; message-feedback coverage pins sidecar cleanup.
