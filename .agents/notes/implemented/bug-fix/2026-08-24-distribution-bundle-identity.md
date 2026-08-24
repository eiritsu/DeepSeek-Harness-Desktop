# Agent Note: Isolate the distributed desktop identity

Status: implemented

English | [中文](2026-08-24-distribution-bundle-identity.zh.md)

## Problem

Development and distribution builds shared one bundle identifier. A development launch could therefore persist an absolute checkout as `activeSourceRoot`, and a later installed distribution would reuse that path instead of its bundled source snapshot. The release could then depend on local source state and fail differently from a fresh installation.

## Decision

Distribution builds use `ai.deepseek.harness.desktop`; development builds retain `ai.deepseek.harness.desktop.local`. The DMG packaging gate rejects a distribution carrying any other identifier. Both identities continue to use the same Application Support directory for Harness profiles and session data, while macOS preferences that select a source root remain isolated.

## Alternatives considered

**Clear `activeSourceRoot` during every distribution launch.** Rejected because a distribution update legitimately records its staged source version in that preference.

**Keep one identifier and reject checkout paths.** Rejected because an arbitrary absolute path cannot reliably distinguish an intentional source override from stale development state.

## Verification

The distribution packaging command verifies the final signed app's bundle identifier and absence of `DSHSourceRoot`. A development build preserves the `.local` identifier and its explicit checkout path.

## Consequences

Installing the distribution no longer inherits development-only source selection. Existing Harness data remains in place because its filesystem location is independent of the bundle preference domain.
