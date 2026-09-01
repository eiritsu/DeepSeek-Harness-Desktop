# Agent Note: Session deletion and workspace actions

Status: implemented

English | [中文](2026-09-01-session-actions.zh.md)

## Problem

The upstream session refactor retained rename, fork, and archive actions but dropped the permanent deletion route that the pre-refactor Harness exposed. The sidebar therefore offered no deletion action, and the Host had no lifecycle-safe way to remove a durable session and its descendants.

## Decision

Permanent deletion is a Session Controller command. The Host builds one header index from durable and live sessions, rejects missing roots and non-recursive descendant deletion, preflights running or subagent-owned agents, disposes retained live handles, deletes the durable record through the persistence coordinator, and detaches each deleted id from every Workspace. The client manager projects the returned removals and clears the current selection when needed.

The workspace browser exposes the complete session action set in order: rename, fork, archive, add to workspace, and delete. Adding to a Workspace uses the existing Workspace entity validation and a Host command, so session and workspace directories remain consistent instead of allowing a UI-only membership change.

## Consequences

Deletion is child-before-parent and cannot leave a live agent or Workspace membership pointing at removed storage. The operation is intentionally permanent and is guarded by a confirmation dialog. Existing archived sessions remain separate from deletion and keep their durable logs.

## Alternatives considered

**Hide the action and require filesystem cleanup.** This leaves live agents, projections, and Workspace membership inconsistent.

**Delete only the selected log.** This strands durable descendants created by forks or subagents.

## Verification

Focused persistence, Session Controller, Workspace Controller, and workspace-browser tests pass; TypeScript builds for the changed Host and Client packages pass. The full desktop bundle still requires the desktop-shell build smoke before replacing the installed app.
