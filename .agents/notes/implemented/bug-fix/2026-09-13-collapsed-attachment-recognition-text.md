# Agent Note: Collapsed attachment-recognition text

Status: implemented

English | [中文](2026-09-13-collapsed-attachment-recognition-text.zh.md)

## Problem

Office and OCR recognizers record extracted text as a model-visible text block beside the durable attachment. Chat previously concatenated that internal representation with ordinary user text, producing a large user bubble for long documents. The session-title service also treated the extracted body as human title input, so a file-only prompt could receive an internal marker or document contents as its title.

## Decision

`dsh-llm` owns the stable encoder and host-side parser for the existing `[DeepSeek Files extracted text from …]` representation. Session Controller and Lark use the encoder, and Session Title uses the parser. The Chat renderer recognizes the same recorded representation locally because Client feature packages cannot import Host feature values. Both parsers accept current and previously recorded blocks without changing the Session format or model-visible bytes.

Chat separates recognized attachment text from ordinary user text. Each recognized body appears in a localized disclosure beside the attachment and is closed by default; expansion reveals the complete recorded text in a bounded scrolling region. User-message copy actions receive only ordinary user text.

Session titles exclude parsed attachment-recognition blocks from both deterministic fallback and provider input. A prompt containing only a file and recognized text remains untitled until later ordinary human text arrives.

## Alternatives considered

**Add a new Session content-block type.** Rejected because the extracted text already has a released, model-visible representation. A new type would require a Session format change plus updates to every adapter, SDK, compactor, token meter, and migration without improving the stored information.

**Truncate or discard extracted text in Chat.** Rejected because users must be able to inspect exactly what the recognizer supplied to the model. Default collapse controls layout without hiding or mutating the evidence.

**Keep recognized text eligible for titles.** Rejected because it is derived machine input rather than the user's naming intent and can dwarf a short prompt or become the whole title of a file-only Session.

## Consequences

New and existing recognized documents keep identical durable and model-visible content while occupying one compact row by default. Users can expand the complete extraction, and ordinary prompt text remains independently copyable and title-eligible. The parser reserves the exact DeepSeek Files marker syntax; a manually authored text block using that syntax receives the same derived-content presentation.

Focused LLM, Chat, Session Controller, Lark, migration, and session-title tests pin encoding compatibility, collapsed presentation, producer output, and title exclusion.
