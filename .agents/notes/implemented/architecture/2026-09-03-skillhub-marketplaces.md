# Agent Note: SkillHub marketplaces for desktop discovery

Status: implemented

English | [中文](2026-09-03-skillhub-marketplaces.zh.md)

## Problem

The desktop sidebar had one plugin marketplace, while reusable skills were only available through the model-facing skill runtime. Plugin discovery also exposed multiple community catalogs with different review semantics, making the source shown to users differ from the source inspected before installation.

## Decision

The Web bundle loads a separate `@deepseek-ai/dsh-client-ui-skill-library` Cordis package. On desktop pages with the document-start bridge it registers a `技能库` footer action above `插件库` and a shell overlay whose primary tabs mirror the plugin library: Installed, Review & install, Community discovery, and Operation log. Community discovery maps SkillHub's skills endpoint; its controls follow the SkillHub layout with sort tabs, source/scene/API Key filters, a full-width search field, and single-column result rows. The overlay keeps scrolling inside its own viewport, preloads the next page near the viewport end, and provides explicit previous/next and load-more controls. Skill cards link to SkillHub and download the published ZIP; writing a ZIP into a local skill root is deferred to a dedicated native capability.

Plugin-library community discovery uses SkillHub Plugins as its only visible external catalog. Native review pins each listed GitHub repository to a commit before reusing the existing DSH Bundle inspection and installation token flow. The prior GitHub Topic and third-party catalog UI paths are no longer exposed.

## Alternatives considered

**Embed SkillHub pages in an iframe.** Rejected because the app needs internal scroll, pagination, loading state, and reviewable repository links; API projection also keeps the desktop shell in control of navigation and security messaging.

**Merge skills into the existing slash-invocation package.** Rejected because slash invocation is a model/session reference source, while the marketplace is a desktop management surface with different lifecycle and installation ownership.

**Keep multiple plugin community catalogs.** Rejected because separate catalogs duplicated pagination and review affordances and could imply different installation guarantees. SkillHub Plugins is now the single discovery source; local review remains authoritative.

## Consequences

The desktop distribution carries one additional client bundle and one additional default sidebar entry. SkillHub outages produce a localized loading error without affecting the agent loop. Skill ZIP installation, signature verification, and runtime confinement remain explicit follow-up work; plugin installation continues to require the existing native review token and pinned source.

## Verification

The sibling plugin workspace passes its client TypeScript build, the plugin-library component suite (8 tests), and the complete macOS desktop-shell Swift suite (30 tests). The Harness workspace typechecks the new client package and includes it in the Web bundle dependency graph and Cordis patch.
