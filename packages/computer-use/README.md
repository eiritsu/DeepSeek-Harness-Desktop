---
description: "Computer-use capability packages for selecting and registering one desktop provider."
kind: "package-group"
---

# packages/computer-use

English | [中文](README.zh.md)

## Summary

Computer-use providers let models observe and operate a desktop. This group owns exclusive provider registration and the release Cua Driver native provider. Each provider owns its operations, tools, and platform requirements; the experimental Cua Driver MCP provider lives in the experimental group.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

Choose one provider and mount the shared registration service.

| Package | Role | ctx key |
|---|---|---|
| [`computer-use`](computer-use/README.md) | Exclusive named provider registration | `ctx.computerUse` |
| [`cua-driver-native`](cua-driver-native/README.md) | Cua Driver provider over the native npm SDK | — |

<a id="related-documentation"></a>
## Related documentation

- [Computer use](../../docs/subsystems/computer-use.md) — capability ownership and provider choices.
- [Experimental packages](../experimental/README.md) — the Cua Driver MCP provider.

<a id="dev-note"></a>
## Dev Note

None.
