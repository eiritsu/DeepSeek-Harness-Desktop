# Agent Note: Generic file compatibility

Status: implemented

English | [中文](2026-08-29-generic-file-compatibility.zh.md)

## Problem

The attachment refactor retained image-only admission and transient recognition, so document bytes were neither durable session content nor available to the model after submission. Models without catalog reasoning metadata also lost the selector that existing provider routes exposed.

## Decision

`AttachmentStore` keeps generic file limits, content-addressed `saveFile`/`readFile`, and durable recognizer inputs alongside the image path. Session prompt admission stores file references and records bounded recognizer text in a `file` content block. Provider adapters project file blocks to deterministic text, preserving original bytes in the session attachment store while supporting text-only model routes. The browser composer accepts non-image files through the existing draft-id path; images retain preview and normalization behavior.

Models without provider reasoning metadata expose the fixed provider-neutral `off`, `low`, `high`, and `max` efforts. Explicit levels remain validated when a provider declares a capability map.

## Consequences

Generic files are available to document recognizers, JSON and source files are persisted byte-for-byte, and the same session replay can reconstruct their model-visible text. Command claims remain image-only; ordinary prompt submission carries both image and generic-file parts.

## Alternatives considered

**Keep transient recognition only.** This loses original bytes at the session boundary and cannot support replay or later consumers.

**Treat every file as an image.** This rejects documents at image decoding and prevents recognizers from handling office, text, and JSON formats.

## Verification

Harness `pnpm run typecheck` and focused attachment, conversation, UI attachment, and pi-ai tests pass. Plugin `pnpm run build` passes for the file recognizer, Lark, model catalog, and Deepseek-Files packages.
