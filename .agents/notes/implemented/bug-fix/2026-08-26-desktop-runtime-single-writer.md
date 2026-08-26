# Agent Note: Enforce one desktop runtime per data directory

Status: implemented

English | [中文](2026-08-26-desktop-runtime-single-writer.zh.md)

## Problem

The session persistence coordinator serializes writes inside one Host process, while the JSONL backend intentionally does not provide cross-process writer exclusion. Launch Services normally reactivates an existing macOS application, but a directly launched executable or another application copy can bypass that behavior. Two desktop runtimes using the same Application Support directory can then resume one session from different durable revisions and append overlapping sequence ranges.

## Decision

The macOS shell takes a non-blocking advisory lock on `runtime.lock` in its Application Support directory before source preparation or runtime startup. It retains the open descriptor for the application lifetime and releases it only after the child runtime stops. The lock records the owner process identifier. A second desktop process activates that owner and terminates itself before it starts another Host against the directory.

The lock owns the packaged desktop topology only. CLI processes and custom Hosts still follow the persistence contract's one-live-writer requirement and must use a distinct data root when they run beside the App.

## Alternatives considered

**Add cross-process locking to every persistence backend.** That changes the supported deployment topology and needs backend-specific crash, stale-owner, and portability semantics. The defect is the desktop shell starting a second Host for one desktop data directory, so the shell owns the exclusion.

**Terminate the process that already owns the directory.** Killing an active runtime can interrupt a turn or durable append and makes the newly launched copy choose which user-visible application survives. Terminating the new process preserves the existing owner.

**Rely on Launch Services single-instance behavior.** Launch Services does not cover direct executable launches or separately located application copies, which are the paths that need the guard.

## Consequences

Two desktop application copies cannot concurrently mutate the same sessions once they both contain this guard. A repeated launch brings the existing App to the foreground without leaving a second startup window. During an upgrade from an older build that lacks the lock, the older application must be exited before the guarded build starts. A Swift test holds one lock, verifies that a second owner reports the first process identifier, releases the first owner, and verifies reacquisition.
