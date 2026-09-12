# Agent Note: Retire superseded desktop-fork surfaces from the active build

Status: implemented

English | [中文](2026-09-13-retire-superseded-desktop-fork-surfaces.zh.md)

## Problem

After merging the desktop fork with current upstream, the active tree contained the production Electron application and the fork's Swift shell, early Windows shell, old Client compatibility packages, old LLM catalog adapters, and obsolete SQLite Session backend at the same time. The old packages referenced APIs removed by the upstream Session, attachment, LLM, Web, and Client refactors, so the repository no longer typechecked. Keeping those files inside the workspace also made package discovery and release tooling treat incomplete migration sources as current product code.

## Decision

The active build contains only the upstream Electron shell in `apps/desktop` and `apps/desktop-host`. Superseded fork shells, compatibility packages, old package artifacts, and their stale composition tests leave the workspace. Dependencies and third-party notices return to the upstream production graph.

The code is not discarded: merge commit `eaa77a8687` has the complete desktop line as its first parent and the complete upstream line as its second parent. The [desktop-fork Electron migration proposal](../../proposed/architecture/2026-09-13-desktop-fork-electron-migration.md) records the disposition of all 23 fork decision groups and names the eight unique areas that must be reintroduced through current APIs before a Desktop release claims parity. Historical Swift `.app` and `.dmg` outputs in the developer checkout remain untouched and ignored.

Fifteen implemented Agent Notes whose behavior is now owned by upstream Electron, Session, attachment, LLM, or Client code move to the frozen archive. Eight notes remain active because they contain requirements for Lark, SkillHub, external tools, document extraction, OCR, or legacy data recovery that still constrain the migration.

## Alternatives considered

**Exclude the old packages from TypeScript while leaving them in workspace discovery.** Package, documentation, dependency, and release generators would still treat them as current, and future changes could accidentally ship an unverified mix of old and new runtime owners.

**Restore removed upstream APIs until every old package compiles.** This would recreate compatibility surfaces with no current consumer design and would couple the Electron migration to obsolete Session and Client architectures.

**Delete the fork history and retain only copied notes.** Notes cannot preserve executable detail or provenance as faithfully as Git parents. The merge history is the authoritative recovery source, while the migration proposal is the current index.

## Consequences

The repository has one Desktop architecture and the full Host and Client typecheck passes again. Historical source remains recoverable from `eaa77a8687^1`, but Lark, SkillHub, external tools, Office/OCR extraction, and legacy database import are not present in the active application yet and cannot be advertised as preserved behavior. Each returns only with current composition tests, snapshots, documentation, and packaged-Desktop verification.
