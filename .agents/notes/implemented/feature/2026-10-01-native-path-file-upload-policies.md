# Agent Note: Native-path file upload policies

Status: implemented

English | [中文](2026-10-01-native-path-file-upload-policies.zh.md)

## Problem

The Desktop Host can identify a selected file's native path, which lets the composer insert a `@` reference without reading or uploading its bytes. Some file consumers need the original bytes for their own processing while other native-path files should keep using the reference flow.

## Decision

`ui-conversation` provides `ctx.nativeFileUploadPolicies` to Client plugins. A plugin registers a unique id and a predicate over the original browser `File`; registrations compose additively, and each returned disposer removes only its own predicate. Disposing `ui-conversation` clears the registry. The shared `addFiles` intake consults the registry for files that have a Host path and are neither directories nor images. A match enters the existing generic-file upload rail. The composer file picker, paste handler, and attachment drop handler all use this intake. [Generic file upload](2026-08-26-generic-file-upload.md) owns byte transport and persistence.

Images and files without a Host path keep their existing upload route. Directories keep their directory-reference handling, and unmatched native-path files remain `@` references.

## Alternatives considered

- **Upload every native-path file.** Rejected: doing so copies files that existing file tools can already read through their host paths and removes the ordinary reference route from Desktop.
- **Add separate policy checks to picker, paste, and drop.** Rejected: those handlers already converge on `addFiles`; splitting classification would let the same file behave differently by intake gesture.
- **Hard-code Office MIME types or extensions in `ui-conversation`.** Rejected: format ownership belongs to the Client plugin that needs the bytes, and the policy can inspect the original `File` without adding a format catalog to the shell.

## Consequences

Client plugins that need native-path bytes register a predicate for their supported files and dispose it with their contribution. The shell keeps its reference behavior for all other native-path files, so the existing file-reference provider remains useful alongside upload consumers.

## Testing

The registry tests cover additive predicates, duplicate and empty ids, idempotent owner disposal, replacement after `clear`, and independent owners. Conversation intake tests cover policy-matched Office and PDF uploads, unmatched native-path references, directory and image handling outside the policy, per-registration disposal, and registry clearing when the Client plugin unloads.

## Related

[Generic file upload](2026-08-26-generic-file-upload.md) owns upload transport, staged receipts, and file persistence.
