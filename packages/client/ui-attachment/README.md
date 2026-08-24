# @deepseek-ai/dsh-client-ui-attachment

English | [中文](README.zh.md)

Dynamic attachment presentation plugin for the conversation UI. It waits for the conversation package's `conversation.input.attachments` and `conversation.message.images` declarations through `ctx.slots.inject`, then registers the Add launcher's leading “Files and folders” action, composer attachment rail, document drop target, history image gallery, downloadable file cards, and original-image lightbox. The conversation slot owner supplies attachment data, authorized loading, callbacks, and its namespace translator; presentation components remain pure props and are not exported from the package entry.

## Attachment rail

`AttachmentRail` renders pending images as fixed 64px thumbnails and generic files as fixed 180×64px document cards with a filename, uppercase extension, and persistent remove control in one horizontally scrolling row whose scrollbar stays hidden. Each card's declared dimensions include its padding and border, so the rail does not clip the file card or offset its remove control. Overflow is announced by circular edge arrows instead: each pages one viewport (minus one card of context, floored at 200px) with smooth scrolling (instant under `prefers-reduced-motion: reduce`), and arrow visibility is recomputed from scroll geometry on scroll, item-count changes, and rail size changes. A newly added item is revealed at the rail's end; removal keeps the scroll position. Image cards open their original through `onOpen`; file cards remain non-previewable.

## Message images and the lightbox

`MessageImage` renders one durable history image, loading a session-authorized URL through the owner's `ImageLoader`; a failed load renders an explicit retry control, and a settled load answers a single click by opening `ImageLightbox` (clicks during loading are ignored). Sizing follows DeepSeek Chat: a message's lone image (`variant="single"`) renders at 240px on its longer edge with the displayed aspect ratio clamped to [0.25, 4] — the overflow is cropped by `object-fit: cover`, anchored to the top of very tall images and the left of very wide ones — and never upscales past its natural size; an image among several (`variant="tile"`) is a fixed 64px square. `ImageGallery` wraps a message's images in one aligned wrapping flex group (`end` for user messages, `start` for assistant messages), picks the variant from the image count, and renders nothing for an empty list. `ImageLightbox` is a document-level modal preview over the shared dialog mask (`--dsw-alias-bg-mask-1` + `--dsw-mask-blur`, painted on its own layer so the blur never touches the previewed image) that closes on Escape, a mask press, or its close control, and restores focus to its opener on unmount.

## Drop overlay

`DropOverlay` is the full-viewport invitation shown while a file drag is over the page: illustration, title, and a limits line while drops are accepted (`disabled` swaps the blocked illustration and hides the limits line). The layer is pointer-inert — the owner's document-level drag listeners keep the enter/leave count and decide accept/reject; the overlay only shows state. It portals to the body like the lightbox.

## File and folder intake

The Add launcher contributes one paperclip “Files and folders” row and invokes the file picker directly. The macOS desktop shell supplies one Finder panel that accepts files and directories; a normal browser uses its file input directly and accepts directories through drag-and-drop. A selected or dropped directory is archived as one ZIP attachment with relative paths preserved; macOS `.app` bundles therefore arrive as `<name>.app.zip` instead of being discarded as folders.

## Model Experience

None, as the plugin only renders attachment state supplied by the conversation UI and contributes no model-visible input.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **No per-file upload progress** — admission is batch-oriented and reports only accepted drafts or a batch error.
- **Directories become ZIP files** — the browser does not transmit a native directory object, permissions, extended attributes, or macOS code-signing metadata.
- **No zoom or download in the lightbox** — the preview renders the original at fit-to-viewport size only.
- **The lightbox does not trap focus** — it sets `aria-modal` and restores focus on close, but Tab can reach the page behind it.
