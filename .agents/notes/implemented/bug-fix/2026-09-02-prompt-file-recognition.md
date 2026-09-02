# Agent Note: Prompt admission preserves generic-file recognition

Status: implemented

English | [中文](2026-09-02-prompt-file-recognition.zh.md)

## Problem

Browser prompts admitted generic files as durable references but created the user message without asking the mounted attachment recognizer for extracted text. File recognizers therefore worked only when another caller invoked them explicitly, leaving configured Office, PDF, and OCR services unused by ordinary sessions.

## Decision

`SessionCommandController.prompt()` recognizes every admitted generic file before constructing the durable `UserMessage`. The resulting `recognizedText` stays on the file block, so `projectFilesForModel()` projects the same extracted text into every provider request while the session log retains the source reference and text.

## Alternatives considered

- **Recognize in each provider adapter** — rejected because provider-specific serialization would duplicate recognition and could make the durable message differ from the model request.
- **Recognize only when a provider lacks native file input** — rejected because the current provider-neutral message path projects generic files to text and has no reliable native-file capability distinction.

## Consequences

Configured attachment recognizers run as part of normal prompt admission, and recognition failures continue through the existing prompt error mapping. Recognizer latency is paid before the Agent receives the message, while every later model request and replay uses one durable recognition result.
