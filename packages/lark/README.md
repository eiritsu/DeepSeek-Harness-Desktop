---
description: "The Lark package group: typed Lark and Feishu management, official CLI tools, and private-chat Session ingress."
kind: "package-group"
---

# lark/ — Lark and Feishu integration

English | [中文](README.zh.md)

## Summary

The lark group connects a configured Lark or Feishu application to DeepSeek Harness. Its Host package owns credentials, permission inspection, the checksum-pinned official CLI, and private-chat Session ingress. Its Client package exposes the corresponding secret-free management surface. This page maps the group; package-level behavior and limitations remain in each package README.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

<a id="packages"></a>
## Packages

| Package | Role |
|---|---|
| [`lark`](lark/README.md) | Host Remote service, Credentials integration, official CLI tool, permissions, and private-chat Session lifecycle |
| [`../client/ui-lark`](../client/ui-lark/README.md) | Typed desktop Settings projection for application setup, OAuth, scopes, and channel status |

<a id="related-documentation"></a>
## Related documentation

- [Desktop shells](../../apps/desktop/README.md) — Electron packaging and shared desktop data ownership.
- [Session persistence](../../docs/subsystems/persistence.md) — durable history used by private-chat Sessions.

<a id="dev-note"></a>
## Dev Note

Keep provider credentials and subprocess access in the Host package. Client responses remain secret-free and typed through generated Remote artifacts.
