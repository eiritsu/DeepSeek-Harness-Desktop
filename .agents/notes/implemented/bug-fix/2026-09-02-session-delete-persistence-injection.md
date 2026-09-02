# Agent Note: Session deletion declares its persistence dependency

Status: implemented

English | [中文](2026-09-02-session-delete-persistence-injection.zh.md)

## Problem

The Session Remote exposed deletion, but its Host service did not declare the `sessionPersistence` service in its injection list. Gateway dispatch therefore failed before the command ran, leaving the runtime persistence artifact undeleted.

## Decision

`SessionController` declares `sessionPersistence` alongside its other Host dependencies. The existing deletion command remains the owner of deletion: it removes the configured runtime persistence artifact after the live Agent is retired and does not issue a PostgreSQL deletion.

## Alternatives considered

**Read persistence through an optional lookup.** Rejected: deletion requires persistence and should fail at service composition rather than hide a missing required dependency behind a late lookup.

**Delete database records from the Session Remote.** Rejected: the persistence seam owns its backend artifact, while PostgreSQL data is outside this repository's session persistence provider and must remain untouched.

## Consequences

Gateway deletion reaches the command and can remove the user runtime volume's session artifact. PostgreSQL records remain unchanged, and deployments that need database retention or cleanup must manage that policy separately.
