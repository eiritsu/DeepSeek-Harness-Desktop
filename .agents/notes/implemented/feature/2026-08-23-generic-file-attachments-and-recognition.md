# Agent Note: Generic file attachments with sideloadable recognition

Status: implemented

English | [中文](2026-08-23-generic-file-attachments-and-recognition.zh.md)

## Problem

The Web attachment path admitted only four raster formats. The browser composer rejected documents, archives, audio, video, unknown extensions, directories, and macOS application bundles before the host could store or inspect them. Adding every parser to the core would turn format support into a release-coupled dependency and give untrusted compressed documents an unbounded parsing path.

“Support every file type” has two distinct obligations: preserve and transport arbitrary bytes without format allowlisting, and derive model-useful semantics only when a trusted bounded recognizer understands the format. Treating semantic recognition as a prerequisite for storage would continue rejecting unknown formats and make one parser failure lose the user's file.

## Decision

`ctx.attachments` stores arbitrary file bytes as immutable `FileAttachmentRef`s alongside normalized image references. The Web wire accepts generic file blocks, the host commits every referenced object before appending the user event, history renders downloadable file cards, session export includes the original bytes, and the LLM runtime projects each file to a provider-neutral metadata header. Empty browser media types become `application/octet-stream`; no extension allowlist controls storage.

The attachment service owns an effect-scoped `FileRecognizer` registry for generic files and normalized images. The first supporting recognizer reads the verified durable object and may return bounded text during prompt admission. The host resolves the selected route's effective modalities before recognition: supported image, audio, video, and PDF input remains native, while unsupported media invokes the recognizer. It records file text in the durable `FileBlock` and image OCR text in the durable `ImageBlock`, so later requests do not depend on rerunning mutable recognizer code. Unsupported generic formats retain the file header without invented text. Newly submitted image, audio, video, or PDF input that has neither native transport nor recognized text is refused before the user message becomes durable.

`@deepseek-ai/dsh-file-recognizer-office` is an installable Profile Bundle rather than a core parser dependency. It recognizes UTF-8 text and source files, Markdown, CSV/TSV, Office Open XML, OpenDocument, and PDF with input, archive-entry, uncompressed-byte, and extracted-character limits. Optional OCR, audio transcription, and video understanding use separately configured OpenAI-compatible endpoints. Their Model IDs and API Base URLs or complete operation URLs live in the plugin settings namespace; `/v1` and `/api/v1` bases receive the standard operation path. API key values remain in the credentials provider behind fixed references and resolve immediately before each request. Desktop plugin review installs an exact npm version or pinned Git commit into the DSH home profile with lifecycle scripts disabled. Updating the source checkout does not replace that installed dependency; pre-release core/plugin API compatibility is still not promised.

The stock Web profile includes this Bundle as the default `Deepseek-Files` plugin. The Bundle also inserts its own first-level Settings section, so replacing the Bundle replaces its configuration UI with it. A Web profile whose Bundle list begins with the installation-owned base and Web rows receives a missing default Bundle while retaining later installed Bundles. The desktop plugin library projects the built-in Bundle in its installed inventory with the exact version from the current package manifest and marks it as non-removable through external dependency controls.

The Add launcher exposes one leading paperclip row named “Files and folders” and invokes the picker directly. The macOS shell implements the WebKit open-panel delegate with one Finder panel that accepts files and directories; normal browsers retain their file input and directory drag-and-drop paths. Selected and dropped directories are archived as one ZIP with relative paths preserved. A macOS `.app` bundle therefore becomes `<name>.app.zip`; browser transfer does not preserve executable permissions, extended attributes, or code-signing metadata.

This decision extends the durable lifecycle introduced by [Web multimodal image input and durable attachments](2026-07-22-web-multimodal-image-input-and-durable-attachments.md) and the optional UI package established by [dynamic client render and attachment ownership](../architecture/2026-08-17-dynamic-client-render-and-attachment-ownership.md).

## Alternatives considered

**Bundle every document parser into the attachment core.** Rejected because storage must remain format-neutral, parser dependencies and vulnerabilities evolve independently, and deployments need to omit or replace recognizers without forking the core.

**Reject unknown formats until a recognizer is installed.** Rejected because recognition is not required for durable transfer, download, export, or a truthful model-visible file header.

**Pass arbitrary binary blocks directly to every model provider.** Rejected because provider file APIs and supported media differ. The provider-neutral projection is deterministic text unless both the selected model declaration and its adapter protocol implement the exact modality. Google protocols serialize native audio, video, and PDF as inline media; other protocols use recognition text without changing durable file ownership.

**Require a native combined file-and-directory picker.** Rejected for the Web product because standard browser inputs expose separate file and directory modes. Native shells may replace the choice with an operating-system picker while preserving the same attachment wire.

## Consequences

Every file format can cross the Web intake, durable store, history download, and export path, while semantic quality depends on native protocol support or installed recognizers and configured providers. Google routes with exact catalog declarations receive audio, video, and PDF bytes directly; other routes consume durable fallback text without losing the original file. Compressed directory and document handling is bounded, but parsing trusted local plugin code still expands the host's dependency and security footprint. Remote recognition sends the complete bounded attachment to the configured provider, whose retention and format support remain outside Harness control. Directory ZIP conversion preserves hierarchy but not full filesystem metadata. Files remain subject to admission and per-request base64 limits; large-media streaming, per-file progress, retention, and reference-aware garbage collection remain separate capabilities.
