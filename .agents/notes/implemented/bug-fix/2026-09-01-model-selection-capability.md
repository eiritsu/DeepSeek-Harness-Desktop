# Agent Note: Model selection keeps provider capabilities

Status: implemented

English | [中文](2026-09-01-model-selection-capability.zh.md)

## Problem

## Decision

The model selector retains pi-ai reasoning metadata when a configured route is an alias of a known provider by resolving `ownedBy` before applying route overrides. When neither the route nor its upstream owner has an exact catalog entry, `llm-dsh-ai` exposes the shared effort list and installs the selected level into the dispatch model. The model catalog resolver supplies exact levels before dispatch, so stale persisted values are rejected before provider I/O. User-facing diagnostics use the `dsh-ai` name while the pi-ai dependency remains internal.

The selector menu uses a bounded responsive width and hides horizontal overflow inside the model list. Long provider or model ids remain ellipsized instead of creating a second scrollbar.

## Alternatives considered

**Provider-only declarations:** rejected because upstream catalog metadata is authoritative for models that are not locally configured and provider defaults can be stale.

**UI-only filtering:** rejected because dispatch must also reject an inherited value before network I/O.

## Consequences

Coverage includes catalog and adapter resolution for known and unlisted models, UI effort selection, and the existing focused client selector suite. The desktop shell must be rebuilt after these source changes so the installed App uses the updated client bundle.
