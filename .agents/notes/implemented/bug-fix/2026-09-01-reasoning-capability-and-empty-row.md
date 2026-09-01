# Agent Note: reasoning controls follow provider capability metadata

Status: implemented

English | [中文](2026-09-01-reasoning-capability-and-empty-row.zh.md)

## Problem

The model picker exposed Off/Low/High/Max for models whose provider metadata did not declare reasoning support. The adapter then promoted those models at dispatch time, so the control could be selected without a provider guarantee and had no reliable wire effect. Providers can also emit an empty reasoning block before text or when reasoning is disabled, leaving a blank Think row.

## Decision

Only catalog or profile-declared reasoning capabilities are selectable. An explicit effort for a model without that capability is rejected before provider I/O. Empty reasoning blocks are omitted from the assistant disclosure surface.

## Testing

The pi-ai catalog and adapter tests assert that an undeclared model exposes no reasoning control, while declared levels remain selectable. The chat coverage test asserts that an empty reasoning block renders no disclosure row.

## Consequences

An unlisted model must declare `reasoningEfforts` in its provider profile before the UI offers a working effort selector. Catalog models continue to expose the exact levels their adapter supports.
