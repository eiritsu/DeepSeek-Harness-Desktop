# Agent Note: Close Desktop metadata and Workspace regressions

Status: implemented

English | [中文](2026-09-14-desktop-metadata-and-workspace-regressions.zh.md)

## Problem

Desktop retained the dynamic model catalog but `llm-pi-ai` no longer consumed its reasoning metadata for custom routes. The catalog also required identical same-ID reasoning declarations, so equivalent upstream routes with different extra levels removed the whole selector. Session token statistics converted an omitted provider cache-read field into zero, which displayed a false `0%` cache-hit value. A host launch request without a browser deadline left the Open In button permanently guarded after a stalled transport. Feishu conversations created with an empty `conversationCwd` inherited the shell process directory; after an application or checkout moved, Workspace validation hid the old group and placed its surviving Session under Ungrouped.

## Decision

`llm-pi-ai` asks the effect-scoped reasoning resolver only for models whose profile does not declare `reasoningEfforts`, then materializes the returned levels into the same pi-ai descriptor used by inspection and prepared calls. The models.dev parser recognizes `none` and `toggle` as the canonical `off` level. An owner-less exact model ID uses the intersection of reasoning levels across matching declarations, preserving shared levels without combining provider-specific capabilities. Cache-read usage remains optional through the durable projection. One unreported contributing attempt marks the aggregate incomplete instead of converting the missing value to zero; confirmed positive cache reads remain visible, while Chat withholds an exact cache-hit percentage.

The Open In apps response carries a configured client request deadline. The browser aborts a launch at that deadline, releases its in-flight guard in `finally`, and aborts outstanding launches when its plugin unloads. Lark and Feishu use `$DSH_HOME/workspaces/lark` when `conversationCwd` is empty, create that directory before the bridge starts, and give a newly created Workspace a brand-owned title. Explicit directories and persisted Session directories remain unchanged.

## Alternatives considered

**Prefer one arbitrary upstream provider declaration.** Rejected because a custom gateway route without owner or endpoint identity would gain capabilities that its actual backend might not support.

**Continue rendering missing cache reads as zero.** Rejected because zero is a provider measurement while absence means the provider supplied no cache accounting.

**Move old Feishu Sessions to the new directory automatically.** Rejected because released Session headers and Workspace membership are durable authorities. Restoring an old path is a deployment repair; new Sessions use the stable default without rewriting historical data.

## Consequences

Custom models again expose upstream reasoning controls when the catalog has safe evidence, while explicit profile declarations continue to win. Token totals include known input, output, and confirmed cache-read usage; an incomplete cache numerator displays as a confirmed amount without an exact hit percentage. A stalled local-launch transport becomes a recoverable click failure. New Feishu Sessions stay grouped across application upgrades; existing Sessions remain readable at their committed directory.

## Verification

Focused tests cover reasoning parsing and intersection, adapter consumption and explicit precedence, unknown, partially confirmed, and measured-zero cache accounting, launch timeout recovery and disposal, branded Workspace creation, Tavily native-provider priority, Office recognition fallback, attachment drop handling, and the shared Web plugin-library bridge used by Electron on every platform. Type checking, documentation gates, packaged-runtime audits, and installed application smokes cover the assembled Desktop profiles.
