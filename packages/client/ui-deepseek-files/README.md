---
description: "DeepSeek Files provider settings and separated desktop configuration and Session-data maintenance controls."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-deepseek-files

English | [中文](README.zh.md)

## Summary

This browser settings surface is installed by the `Deepseek-Files` Profile Bundle. It contributes one first-level `settings.section` entry, binds the `file-recognizer-office` settings namespace without modifying the Settings shell, and shows the data-maintenance operations supported by the active Swift or Electron bridge.

## Table of Contents

- [Settings and data operations](#settings-and-data-operations)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

## Settings and data operations

The page edits Model ID and API Base URL or complete Endpoint URL values for OCR, audio transcription, and video understanding. API key values travel through the credentials RPC and never enter the settings document; the page reads only configured/writable metadata and cannot recover an existing key value.

Supported desktop shells also receive a separate Desktop Data section. Configuration archives remain sanitized and exclude credentials, Session transcripts, and attachments. Session database export/import is a distinct operation over the closed authoritative SQLite file and explicitly contains transcripts. The Swift shell exposes both operations; Electron currently exposes the Session database operation. Both stop and restart their Host around SQLite replacement or reset.

## Model Experience

### Recognition settings

#### What the model sees

This package contributes no model text. The configured `dsh-file-recognizer-office` provider owns and logs any recognized attachment text.

#### Token effect

None from opening or editing settings. Recognized text has the bounded token effect documented by the provider package.

#### KV Cache effect

None. The configured provider's recognized text follows the recognizer package's bounded attachment projection.

## Known Limitations and Deferred Work

- The page configures protocol endpoints but does not probe provider capabilities before saving.
- A read-only settings or credential source remains visible but cannot be modified from this page.
- Sanitized configuration archive parity is not yet implemented by Electron; the UI only renders that operation when the Swift bridge is present.

No runtime invariant companion is published; this client Settings projection owns no durable event stream or independently mutable cross-plugin relation.

<a id="dev-note"></a>
### Dev Note

Keep configuration archives and unredacted Session SQLite backups as separate operations with separate copy and bridge methods.
