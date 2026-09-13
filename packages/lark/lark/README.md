---
description: "Lark and Feishu application management, official CLI tools, and durable private-chat Sessions for DeepSeek Harness."
kind: "package-bundle"
---

# @deepseek-ai/dsh-lark

English | [中文](README.zh.md)

## Summary

`dsh-lark` connects a managed or self-built Lark/Feishu application to DeepSeek Harness. It stores secrets through DSH Credentials, runs the verified official CLI, registers the model-visible `lark_cli` tool, and maps an authorized user's private chats to durable Harness Sessions. The desktop profiles mount it together with the separate Client settings package.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount the package in a composition and open **Lark Management** in Settings. Official quick connect creates an application through the Lark Channel SDK and then continues current-user OAuth. Advanced setup accepts an existing App ID and write-only App Secret. Both paths isolate OAuth and CLI state under `$DSH_HOME/lark-cli`; the verified official CLI binary is installed under `$DSH_HOME/lark-cli-bin`.

```yaml
- name: '@deepseek-ai/dsh-lark'
```

Application permission grants and current-user OAuth are separate. The Settings page reports both identities and missing scopes. Its copy action writes the batch permission template directly to the clipboard without rendering the JSON. A self-built application must enable long-connection event subscriptions and subscribe to `im.message.receive_v1`.

Private-chat ingestion is enabled by default. `conversationUserOpenId` restricts it to the authorized user; group messages and other senders do not reach an Agent. `conversationCwd`, `conversationTimeZone`, handshake/response timeouts, CLI deadlines, output limits, and connection enablement are validated Cordis configuration fields.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The Host exposes a typed `larkManagement` Remote service and keeps App Secret plus unfinished OAuth state in Credentials. Read-only official CLI commands proceed directly; commands not proven read-only enter the normal DSH approval flow. CLI secrets use stdin and never enter argv, renderer responses, or logs.

Each `(App ID, chat ID)` maps to one stable Session. Incoming text, downloaded files, and recognized attachment text are logged with Lark message and sender identifiers, so a repeated platform message ID is not resubmitted. New chats use `conversationCwd` and the current default model; restored chats retain their persisted cwd, Workspace membership, Session ID, and model. Text and structured file/image attachment replies return to the originating message. Teardown stops intake, waits for in-flight work, disconnects the channel, and releases plugin-owned Agents.

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | settings, credentials, Remote methods, CLI tool, and approval gate |
| [`src/conversation.ts`](src/conversation.ts) | private-chat lifecycle, durable Session mapping, attachments, and replies |
| [`src/permissions.ts`](src/permissions.ts) | capability scopes and import template |
| [`vendor/larksuite-cli`](vendor/larksuite-cli) | checksummed cross-platform official CLI launcher |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Lark Client settings](../../client/ui-lark/README.md) — browser management surface.
- [Session persistence](../../session/session-persistence/README.md) — durable event authority used by private chats.
- [Attachments](../../attachment/attachment/README.md) — file storage and recognition seam.

-----

<a id="model-experience"></a>
## Model Experience

### Official CLI and private-chat input

#### What the model sees

The tool catalog contains `lark_cli` with a string-array command argument. Private-chat text enters as a logged user message; files enter as structured attachment blocks with recognized text when available. Application secrets, OAuth device codes, permission-template JSON, and raw CLI configuration never enter model context.

#### Token effect

Tool results and recognized attachment text consume context like other logged tool and user content. Configuration and permission status do not consume tokens unless a user explicitly asks the Agent to query Lark.

#### KV Cache effect

Stable tool declarations are cacheable. Chat-specific text, attachments, and CLI results vary per turn and extend the Session transcript.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Lark service availability, application approval, scopes, and long-connection delivery remain external dependencies.
- The bundled CLI checksum table supports reviewed Darwin, Linux, and Windows targets only; a new upstream CLI release requires a checksum and packaging update.
- Private-chat admission intentionally supports one configured authorized Open ID per application and does not accept group chats.

No runtime invariant companion is published; the gateway exposes no independent durable relation beyond Session, tool, credential, and Settings services that own their checks.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This package was ported from the desktop fork to the current Settings, SessionQuery, Attachment, Typert, and lifecycle APIs. Do not restore the removed package-root `dsh.client` declaration; the Client package is mounted by current compositions.

</details>
