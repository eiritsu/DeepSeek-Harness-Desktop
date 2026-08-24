# @deepseek-ai/dsh-attachment

English | [中文](README.zh.md)

The durable attachment seam. `ctx.attachments` stores arbitrary files byte-for-byte as `FileAttachmentRef`s and validates provider-independent normalized images as `ImageAttachmentRef`s; consumers never persist browser paths, object URLs, provider URLs, or base64 in session events.

`saveFiles` enforces count, per-file, aggregate-byte, media-type, and canonical-base64 admission before publishing ordered immutable references. `readFile` verifies the digest, byte length, and metadata. Trusted plugins register effect-scoped `FileRecognizer`s for generic files and normalized images; the first supporting recognizer may return bounded text at prompt admission. The host records file text in `FileBlock` and image OCR text in `ImageBlock` before either becomes model-visible. Unsupported or failed generic-file recognition retains the file header without inventing content; a new image for a text-only model is refused when recognition returns no text.

Unsent composer images remain browser-owned temporary drafts. `validateImage` runs the complete admission policy without persisting. `saveImages` owns batch count and aggregate-byte limits, prepares every normalized attachment before publishing any member, then commits in order and returns references only after the complete batch succeeds. A later storage failure returns no partial references, although an earlier immutable content-addressed object may remain unreachable until reference-aware garbage collection exists. `AttachmentError.code` uses the closed `AttachmentErrorCode` string union. Its `ImageAdmissionErrorCode` subset marks caller-correctable image-input failures; `isImageAdmissionError` recognizes that subset at runtime so each protocol adapter can map its own error vocabulary. `saveImage` commits one accepted image before any model-visible session event is published and returns its `ImageAttachmentRef`. When normalization reduces the raster, the reference records the orientation-applied input size in `originalDimensions`. `readImage` verifies the normalized attachment against its logged metadata. `readImageRequest` deterministically derives a route-sized request version whose identity covers the attachment id, transform version, pixel and byte budgets, and encoder settings. Callers compose ordered batches with `Promise.all(refs.map(...))`; the local implementation still bounds compression through its instance limiter, cache, and singleflight. Callers may cancel reads and projections; implementations preserve cancellation instead of translating it into a storage failure.

`admitEncodedImages(attachments, images)` and `admitEncodedFiles(attachments, files)` are the shared wire entries for browser uploads. Both enforce canonical base64 before delegating ordered batch admission to the service. Slash commands retain their explicit image-only attachment declaration; generic files are refused rather than silently dropped.

## Model Experience

Indirectly, through role-neutral `ImageBlock` and `FileBlock` values. Provider adapters resolve images into exact request versions. The LLM runtime preserves `audio`, `video`, and `pdf` files when the selected route can serialize that exact modality; otherwise it projects durable recognition text and metadata. Images similarly use native input or durable OCR text.

#### KV Cache effect

Adding an image or file changes the provider request and therefore invalidates the affected request suffix.

## Known Limitations and Deferred Work

- Version one accepts PNG, JPEG, WebP, and GIF only.
- Retention and garbage collection are deferred because resumed and forked sessions may share immutable objects.
- Native audio, video, and PDF transport depends on the selected adapter protocol; `Deepseek-Files` recognition remains the fallback where the route cannot serialize the modality.
- Persistent unsent drafts require a separate lifecycle contract.
