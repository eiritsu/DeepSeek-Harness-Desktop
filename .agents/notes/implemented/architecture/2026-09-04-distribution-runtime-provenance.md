# Agent Note: Distribution runtime provenance is pinned and verified

Status: implemented

English | [中文](2026-09-04-distribution-runtime-provenance.zh.md)

## Problem

The desktop distribution combined files from local Harness and plugin checkouts with built artifacts, while first launch installed dependencies after unpacking the snapshot. A dirty checkout or an untracked plugin file could therefore produce an installer whose source, artifacts, and later GitHub update did not identify the same revision.

## Decision

Distribution packaging requires clean Harness and plugin checkouts and requires each checkout HEAD to equal its published `main` ref before creating the archive. The snapshot is copied from committed Git trees rather than the mutable index/worktree file list. The archive contains a `runtime-manifest.json` with the Harness commit, plugin commit, package versions, and SHA-256 digests for the CLI, Web, lockfile, and bundled plugin artifacts. The desktop shell validates this manifest and every listed artifact before replacing its managed source snapshot. Shared Application Support source is replaced only by a newer application build, so an older installed copy cannot downgrade a newer runtime.

## Alternatives considered

**Continue copying the local worktree.** Rejected because untracked files and independently built `lib` directories can make the archive differ from the revision users can retrieve or reproduce.

**Trust only the application build number.** Rejected because a timestamp identifies an installation attempt but cannot prove which source and artifact contents it contains.

**Fetch GitHub during every first launch.** Rejected because startup would depend on network availability and could combine a new binary with an incompatible moving branch.

## Consequences

An unpublished or dirty checkout cannot generate a distribution DMG, and a tampered or incomplete bootstrap archive fails before activation. Multiple installed copies can share the managed source without an older copy replacing a newer one. Building still has a first-launch dependency install until the sealed runtime migration is complete, but that install now runs against a pinned, inspectable source snapshot. The manifest provides the provenance data needed for the later no-install runtime closure.
