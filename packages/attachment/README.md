# attachment/ - durable attachment capability family

English | [中文](README.zh.md)

The durable binary attachment seam, its local filesystem implementation, and optional recognition providers.

| Package | Role | ctx key |
|---|---|---|
| `attachment/` | Immutable file and image references, admission limits, storage service, and recognizer registry | `ctx.attachments` |
| `attachment-local/` | Content-addressed private storage below `DSH_HOME` | (registers on `ctx.attachments`) |
| `file-recognizer-office/` | Installable bounded text, Office, OpenDocument, and PDF recognition Profile Bundle | (registers a file recognizer) |

Unsent browser drafts are intentionally outside this capability. Bytes enter durable storage only when a user prompt is submitted or when a provider adapter commits structured model output.
