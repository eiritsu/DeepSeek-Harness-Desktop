# Agent Note: Preserve desktop-fork behavior on the upstream Electron application

Status: proposed

English | [中文](2026-09-13-desktop-fork-electron-migration.zh.md)

## Problem

The desktop fork diverged from upstream after `dd6322d604` through 78 commits. It added native macOS and Windows shells, release preparation, plugin and Skill marketplaces, Lark, external search providers, Office and OCR extraction, model metadata compatibility, SQLite persistence, session actions, and native file interactions. Upstream subsequently replaced the Web Client, Session persistence, LLM metadata, attachment, and Desktop architectures. Replaying the old patches would restore removed APIs, duplicate newer upstream behavior, and leave the retained features unable to compile.

The merge commit `eaa77a8687` keeps both complete parent histories and brings the branch to zero commits behind `origin/master`, but historical reachability alone does not make every fork feature available on the new runtime. The migration needs an explicit inventory that distinguishes behavior already present upstream from behavior that still needs a current owner.

## Proposal

Use `apps/desktop` and `apps/desktop-host` as the only production Desktop shell. Keep the merged Swift and early Windows Electron sources reachable through the first-parent desktop history until each behavior is either mapped to the upstream Electron implementation or reimplemented there. Do not ship or maintain two production shells.

Classify the fork work as follows:

| Fork work | Upstream state | Migration action |
|---|---|---|
| macOS Swift shell and early Windows Electron shell | Replaced by the signed Electron application for macOS and Windows | Retire the old shell sources after behavior mapping; add Linux packaging only as a separately qualified target |
| bundled Node, pnpm, source provenance, startup readiness, single instance, plugin mutation, recovery, updates, signing, and cookie isolation | Replaced by the port-free Desktop Host, versioned runtime inventory, managed profile, plugin manager, recovery page, auto-updater, and platform signing | Keep upstream ownership; do not reintroduce the loopback server or source-at-first-launch design |
| session rename, fork, archive, delete, Workspace membership, Web compaction, generic file upload, image handling, reasoning metadata, and model selection | Present in newer upstream capabilities and Client models | Remove the fork compatibility layers after focused parity tests confirm the user-visible behavior |
| native file and directory selection, drag-and-drop, session export, and external navigation | Mostly present through current Client upload, directory-picker, deliverables, export, and open-in-app capabilities | Port only missing Electron-specific affordances through narrow preload IPC |
| Lark/Feishu private-chat agent and management UI | Absent upstream | Port to current Agent lifecycle, Session journal, Typert Remote, Slots, and locale APIs |
| SkillHub plugin and Skill discovery | Absent upstream; Desktop already owns package mutation | Add discovery and review to the current Desktop plugin manager; give Skill installation a separate reviewed filesystem operation |
| Brave, Tavily, Exa, GitHub, and Firecrawl connections | Partly overlaps upstream Exa provider but not the credential-gated catalog and settings surface | Keep dedicated tools; register one aggregate `WebSearchProvider` that applies saved priority internally so `WebRuntime` still has an unambiguous provider |
| Office, PDF, audio/video fallback, and image OCR | Generic files are durable upstream, but extraction is absent | Introduce a complete extraction capability with Service Definition, providers, and prompt/read Consumers; keep extracted text model-visible through Session events |
| model-catalog compatibility package and generic reasoning fallback | Replaced by adapter-owned `resolveModelInfo`, configurable pi-ai routes, and the installed pi-ai catalog | Delete the compatibility package after migrating any catalog entries not represented by pi-ai configuration |
| authoritative SQLite Session persistence | Explicitly removed upstream in favor of JSONL; current persistence handles and Session format differ | Do not restore SQLite as a live backend; implement a one-shot, version-checked import from the recognized desktop database into current JSONL and retain the source database as recovery evidence |
| plugin-library and client-runtime compatibility packages | Replaced by the Electron plugin window and current Client module/Slot APIs | Rebuild only unique marketplace behavior; do not keep runtime re-export shims |

Each retained feature must use current package boundaries. A Host and Client package uses separate compiler faces where needed. Product-visible UI uses typed locale dictionaries and Slots. Any model-visible extraction is logged. Runtime provider selection remains explicit and disposal-safe. Legacy data import recognizes one exact schema, writes through current public services, is idempotent, and never deletes the source.

Migration lands in reviewable stages: establish the upstream Electron baseline; remove superseded compatibility code from the active build; port external tools; port Lark; add extraction; add SkillHub; add legacy data import; then qualify packaged macOS and Windows artifacts. The old files may leave the active tree only after the merge parent and this mapping make their history and disposition inspectable.

## Alternatives considered

**Continue the Swift shell and maintain a separate Windows Electron shell.** This keeps the current macOS behavior temporarily, but duplicates lifecycle, packaging, update, security, and plugin-management work and does not provide one portable product architecture.

**Replay all 78 commits onto current upstream.** The commits target APIs that no longer exist and include compatibility behavior superseded by upstream designs. A textual replay would compile only after restoring deprecated surfaces and would create competing owners for Session, attachment, LLM, and Client state.

**Drop the fork and start from upstream without its history.** This produces a clean tree but loses reviewable provenance for user data migration and unique features. The two-parent merge is the stronger preservation mechanism while current implementations are rebuilt.

**Keep SQLite as the authoritative Desktop Session backend.** Upstream now treats JSONL as the canonical Session log and SQLite as derived query storage. A second authoritative format would split lifecycle and recovery semantics; a narrow importer preserves user data without reviving that split.

## Acceptance criteria

- The integration branch contains both original histories and is not behind upstream.
- The default build and focused Desktop tests pass without loading the legacy shells or removed compatibility APIs.
- Every one of the 23 fork Agent Notes is either mapped to a current upstream owner, superseded and consolidated, or retained with a named migration owner.
- Lark, external tools, Office/OCR extraction, SkillHub, and legacy Session import have current composition tests and user-visible snapshots before they are declared preserved.
- Packaged macOS and Windows builds use the same Electron source and bundled runtime; a future Linux target cannot be advertised until its packaging and native dependency matrix pass.
- Legacy desktop data remains recoverable throughout migration, and no migration step deletes the Swift Application Support data or the SQLite source database.

## Risks

The most serious risk is mistaking source retention for behavior retention. Until the focused tests above pass, unique fork features remain migration work even though their commits are reachable. Lark and extraction touch lifecycle and model-visible data, so shallow adapters could lose history or leak unlogged context. Desktop data exists in several historical roots and formats; an importer that guesses at a schema could corrupt current sessions. Electron improves platform reuse but does not make Linux support automatic because native modules, packaging, signing, system integration, and release qualification remain platform-specific.
