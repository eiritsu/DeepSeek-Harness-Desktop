# Agent Note: Dual macOS shells over one Desktop Host and authoritative SQLite

Status: proposed

English | [中文](2026-09-13-dual-macos-shells-and-authoritative-sqlite.zh.md)

## Problem

The desktop fork has two legitimate product requirements that one shell does not satisfy equally well. Its Swift shell uses substantially less memory and integrates closely with macOS, while upstream's Electron application provides the maintainable path to Windows and Linux. The fork also contains user-visible capabilities that are not preserved merely by retaining its commits: complete model metadata, file and folder attachment entry, Office/OCR and media routing, external search-provider priorities, authoritative SQLite Session storage, backup/export/import, Session actions, cross-Session reads, DeepSeek Files policy, SkillHub, Lark, and command-line improvements.

Replacing Swift with Electron would discard the lightweight macOS product. Maintaining two independent applications would duplicate Session, settings, plugin, update, and data-management behavior and make their data diverge. The current Electron 44 line supports macOS 13 and later, so it cannot cover every Apple Silicon macOS release; Apple's Xcode 26 toolchain can build a native app with a macOS 11 deployment target and the macOS 26 SDK.

## Proposal

Ship two macOS application products from one repository:

- **DeepSeek Harness Lite** uses Swift and the system WebKit/SwiftUI stack. Its Apple Silicon deployment target is macOS 11, and release qualification covers macOS 11 through macOS 26.
- **DeepSeek Harness** uses the upstream Electron application. Its Apple Silicon target follows Electron 44's supported macOS range, macOS 13 through macOS 26. Windows remains an Electron target; Linux remains unadvertised until its native dependencies and package artifacts pass qualification.

The shells contain lifecycle and operating-system integration. Electron launches `apps/desktop-host` with its desktop patch and serves the renderer through the private `dsh-app:` protocol. Swift launches the supported `dsh --profile desktop-lite --no-open --port 0` entry point and embeds that loopback Web application in `WKWebView`. Both profiles extend the same Web Client composition and mount the same desktop feature packages, but their transport and native picker rows differ. Electron and Swift share one process-lifetime ownership lock at `$DSH_HOME/desktop/runtime.lock`; a second shell reports the active owner instead of opening the same data concurrently.

Desktop uses `dsh-desktop.sqlite` as the authoritative Session store. The current handle-based `SessionPersistence` API owns append ordering, live-event batching, flush durability, current-format validation, and Session reconstruction. SQLite stores headers, inherited cuts, events, counts, and monotonic revisions transactionally. JSONL remains the default for non-desktop profiles. Existing desktop SQLite rows and supported JSONL generations migrate through explicit versioned import paths; migration never guesses a layout or deletes its source.

Each shell stops its Host before data maintenance. The two user operations remain distinct: the existing Swift configuration archive has a versioned manifest and excludes credentials, Session bodies, attachments, machine identity, and logs; the Session database export copies the closed authoritative SQLite file without redaction, validates its schema before export and import, and rolls back a failed replacement. Electron implements the same Session-database operation through narrow, sender-checked IPC. Full Session-log export remains a separate user action and includes the selected Session only. A shared Host service for configuration archives is deferred; documentation and UI must not imply that the two backup kinds have the same confidentiality properties.

The fork feature inventory has these current owners:

| Capability | Current owner and migration rule |
|---|---|
| Complete model metadata and reasoning capability | Absorbed by current `llm-pi-ai` route metadata; the fork's separate model catalog is not restored |
| File/folder GUI, drag-and-drop, and all Session files | Current attachment and file-upload packages carry `mediaType`; browser folders and native Swift files/directories enter through separate bounded actions |
| DeepSeek Files routing | `file-recognizer-office` registers on the current Attachment recognizer seam; prompt admission preserves native model modalities and logs fallback text |
| Session rename, fork, archive, delete, Workspace membership, id copy, and log download | Upstream already owns rename, fork, archive, and log download; this migration adds durable recursive delete, attach-to-Workspace, and copy-id actions |
| Cross-Session reads | Already owned by current `session-reference`, `session-query`, and unified reference picker packages |
| Brave, Tavily, Exa, GitHub, and Firecrawl | Restored as one Web provider whose saved enabled state and priority override the base provider at request time |
| Backup/export/import/reset | Shells stop their Host and implement separate sanitized-configuration and unredacted-Session operations; Session SQLite validation and rollback have parity tests |
| SkillHub | The restored current Client package serves both shells; Swift and Electron own bounded catalog requests, archive validation, installation, enumeration, and exact-name removal behind narrow bridges |
| Lark | The ported Host capability owns credentials, official CLI execution, approval classification, durable private-chat Sessions, attachments, and lifecycle; the ported Client package owns typed Remote settings UI |
| `dsh` command improvements | Current upstream already contains shipped profile templates, exclusive template creation, and simplified option forwarding; this change adds only the `desktop-lite` template |
| Subagent 0.1.5 regressions | Current native-backed catalog, settlement, continuation, and teardown tests pass; every reported fix is already present upstream |

Every retained capability uses current package roles and Cordis effects. Client copy stays in typed locale dictionaries. Every model-visible file extraction, cross-Session input, provider result, and Lark message remains reconstructable from the Session log. SkillHub installation rejects invalid identifiers, oversized responses, symbolic links, excessive archive entries, missing manifests, duplicate destinations, and ambiguous removal names.

## Current audit evidence

The first current-tree audit of `packages/subagent` passes all 826 tests after building the repository's Darwin arm64 `system.node`. The initial failures were all missing-native-addon setup failures, not reproduced subagent defects. The merged upstream history already contains the reported 0.1.5-era fixes for invalid catalogs and snapshot ordering (`661135fe29`), rejected runs after catalog failure (`ba731d1c9e`), declaration augmentation (`0274a6dd75`), Host catalog event exports (`924282cbcd`), catalog event ordering (`80e34ce709`), parent-owned catalogs (`2db4bdd31d`), preset teardown (`3a98d05a3d`), and `agent-started` cleanup (`e7bde97aa0`). No additional subagent code change is justified until a behavior fails with the native prerequisite present.

The SQLite migration test constructs the original desktop schema and a released v0 Session, then verifies startup rewrites it through the installed v0-to-v3 catalog before `stat`, `open`, or append can observe it. The JSONL and SQLite persistence suites, including durable deletion, currently pass 210 tests. Swift's 47 tests include authoritative Session database export, import, reset, and schema validation.

The ported Lark Host and Client suites pass 40 tests against the current settings, SessionQuery, attachment, Typert, and lifecycle APIs. Electron SkillHub bridge tests cover untrusted request parsing, catalog projection, installed-manifest enumeration, and exact removal; the shared Client tests cover controller state and result normalization.

## Alternatives considered

**Electron only.** This maximizes shell reuse but discards the lightweight native product and excludes macOS 11 and 12 because the current Electron line does not support them.

**Independent Swift and Electron applications.** This preserves both interfaces but creates two authorities for Session, settings, backup, plugins, and migration. Feature and data drift would be a permanent release risk.

**JSONL as the desktop authority with SQLite only for queries.** This matches the generic upstream profile but does not preserve the fork's transactional desktop database, coordinated backup/import behavior, or existing user data model. Keeping JSONL for non-desktop profiles avoids imposing the desktop choice on the core product.

## Acceptance criteria

- The Swift and Electron applications both launch the same bundled Desktop Host and render the same current Client composition.
- Only one Host may own the Desktop home at a time across both shells; a crash releases ownership without manual cleanup.
- SQLite passes the shared persistence and live-write contracts, imports the recognized legacy desktop schema and supported released Session formats, and supplies monotonic `stat`/`list` revisions.
- Session database backup/import/reset has equivalent closed-Host schema validation and rollback behavior in both shells. Configuration archives remain explicitly separate and sanitized.
- The complete fork feature inventory has current code owners and focused parity tests, including SkillHub UI/native installation and Lark Host/Client integration.
- Swift arm64 packages run on macOS 11 through 26; Electron arm64 packages run on macOS 13 through 26. Signing, notarization, update, picker, download, and deep-link smokes pass on the oldest and newest supported releases.
- The 0.1.5 subagent audit records each reported failure as reproduced, already fixed upstream, or not reproducible, with focused tests for every retained fix.

## Risks

Shared TypeScript packages eliminate most duplicate product logic, but two shells still double packaging, signing, update, accessibility, data-maintenance, and operating-system integration testing. A native WebKit shell can expose rendering differences from Chromium even when it loads the same Client bundle. Supporting macOS 11 constrains Swift and WebKit APIs independently of what Xcode 26 can compile. A live SQLite copy can be incomplete because WAL pages are separate, so both shell paths stop the Host before copying. Release parity remains provisional until packaged signing, upgrade, native picker, SkillHub download, Lark connection, and oldest/newest macOS smokes pass.

## Sources

- [Electron 44 release support policy](https://www.electronjs.org/blog/electron-44-0)
- [Apple Xcode system requirements](https://developer.apple.com/xcode/system-requirements)
