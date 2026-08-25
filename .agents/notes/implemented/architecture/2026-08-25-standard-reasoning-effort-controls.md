# Agent Note: Standard Reasoning Effort Controls

Status: implemented

English | [中文](2026-08-25-standard-reasoning-effort-controls.zh.md)

## Problem

Provider and model catalogs disagree about reasoning metadata, many gateway listings omit it, and a private route may expose a capable model under an owner unknown to the catalog. Using those declarations to decide whether the Composer shows a control makes identical session behavior depend on catalog freshness and provider attribution. It also blocks a best-effort request before the endpoint can apply its own compatibility behavior.

## Decision

`LlmRuntime` replaces adapter reasoning metadata with one fixed set for every resolved route: `off`, `low`, `high`, and `max`. The Composer prepends `Default`, which stores no explicit `reasoningEffort`; switching models also returns to `Default`. Core validation accepts only the four explicit standard ids and does not materialize an adapter default into session selection.

`llm-pi-ai` preserves an unchanged model descriptor for Default calls. An explicit level creates a detached request descriptor with reasoning enabled, retains configured `thinkingLevelMap` wire spellings, and makes `max` available under its canonical spelling when no mapping exists. Pi-ai still owns protocol translation, including protocol-specific Off behavior. A provider that does not implement a selected level returns its normal request error; model discovery and `dsh-model-catalog` do not suppress the control.

Native DeepSeek already serializes the same four explicit levels. `reasoningEfforts` remains a private-gateway wire-mapping configuration, not a selector capability declaration; route-level `reasoning` remains the deployment behavior used when the session selects Default.

## Alternatives considered

**Keep adapter-owned per-model menus.** Rejected because missing, stale, ambiguous, or gateway-specific declarations changed UI availability and rejected requests before provider I/O.

**Show every pi-ai level.** Rejected because `minimal`, `medium`, and `xhigh` make the common menu provider-specific again. The four-level set matches the native DeepSeek protocol and the requested cross-provider control.

**Send a synthetic default effort.** Rejected because Default means no session override. Materializing a level would replace provider or deployment policy and make a model switch carry hidden behavior.

## Consequences

- Every advertised model shows exactly `Default`, `Off`, `Low`, `High`, and `Max`, independent of provider, owner, or cloud declarations.
- Unsupported explicit levels fail at the provider rather than disappearing from the UI or failing capability preflight.
- `dsh-model-catalog` remains responsible for input modalities only; it does not parse or publish reasoning controls.
- Session logs retain an explicit standard effort only when the user selects one, so replay preserves the visible choice and Default preserves provider behavior.
