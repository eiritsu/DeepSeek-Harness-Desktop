# Agent Note: Permanent Session deletion is distinct from archive and Workspace removal

Status: implemented

English | [中文](2026-08-28-session-permanent-deletion.zh.md)

## Problem

The Workspace sidebar could rename, fork, and archive a Session, but it could not remove the durable Session log. Archive only hides an id in the Workspace domain's global archive set, and deleting a Workspace removes only its registration. Reusing either operation for permanent deletion would make a destructive action look reversible or would couple Session lifetime to Workspace metadata.

## Decision

`SessionPersistence.delete(id)` is the backend-neutral permanent-deletion primitive. The coordinator runs it after earlier work for the same id, rejects a live persistence owner, cancels an unmaterialized create intent, invokes the backend removal, and emits `session-persistence/deleted` after success. JSONL removes the configured Session artifact and publishes the directory update durably on POSIX; SQLite deletes the Session row in a transaction and relies on its foreign-key cascade for event rows. The SQLite query provider treats the deletion event as a reconciliation trigger, so persistence does not depend on derived indexes.

The Session Controller owns lifecycle and lineage policy. It combines cold headers with live Sessions, computes descendants from `parentSession`, rejects non-recursive deletion when children exist, preflights every target before mutation, and removes children before parents. A running Agent, a subagent-owned lifecycle, or a lifecycle not owned by the API controller rejects deletion. An idle API-owned Agent is disposed before its storage is removed. Successful deletion also detaches every removed id from Workspace accounting.

The Client always requests recursive deletion from the explicit confirmation dialog. The Session row menu presents Rename, Fork, Archive, Add to workspace, and Delete session in that order. Archive remains immediate and reversible in storage terms; Delete session uses danger styling and a confirmation that names the selected Session and its fork descendants. Workspace deletion remains metadata-only.

## Verification

The shared persistence contract runs permanent deletion against memory, JSONL with both encodings, and SQLite, including materialized logs, lazy create intents, unknown ids, and id reuse after deletion. Coordinator tests pin the deletion event. Host tests pin non-recursive descendant rejection, child-before-parent recursive order, and Workspace detachment. Client and component tests pin list removal, selection clearing, the exact five-action menu, attachment, confirmation, and the recursive request.

## Alternatives considered

**Turn Archive into Delete.** Rejected because archive intentionally preserves the log and Workspace position for a future restore surface.

**Delete Sessions when a Workspace registration is deleted.** Rejected because a Workspace is organization metadata; removing it already guarantees that its Sessions remain available under Ungrouped.

**Let persistence dispose live Sessions.** Rejected because persistence cannot distinguish API-owned Agents from subagent or foreign lifecycles. The Session Controller owns that authority and keeps storage independent of Agent orchestration.

## Consequences

Permanent deletion cannot be undone. Recursive deletion is bottom-up, so a process failure can leave ancestors while some descendants are gone; repeating the command converges from the remaining headers. The operation is single-process lifecycle coordination rather than a cross-process transaction. Archive still has no restore UI.
