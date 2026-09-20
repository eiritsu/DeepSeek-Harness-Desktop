# Agent Note: Computer-use provider registration

Status: implemented

English | [中文](2026-09-12-computer-use-provider-registration.zh.md)

## Problem

Desktop providers expose different operations, observation formats, and platform facilities. DSH needs to prevent accidentally enabling two providers in one composition while allowing provider-specific integrations to work without committing to a common action API.

## Decision

The DSH capability is named **computer use**. [`dsh-computer-use`](../../../../packages/computer-use/computer-use/README.md) owns `ctx.computerUse`, which registers one provider-owned name and returns its effect disposer. A second registration fails regardless of its name. The service contains no provider object, shared operation type, dispatch method, Session lock, or runtime selector.

**Cua Driver** names the upstream implementation. The [native provider](../../../../packages/computer-use/cua-driver-native/README.md) is a release package that installs the upstream native npm dependency. The [MCP provider](../../../../packages/experimental/computer-use-cua-driver-mcp/README.md) connects an installed executable and remains experimental on the explicit public-release allowlist. The Desktop and Lite products mount the native provider by default; other profiles select a provider explicitly.

Each integration exposes the upstream tool catalog. MCP result conversion stays in `dsh-mcp-client`, whose callback-based tool adapter also converts native Cua Driver results. The computer-use service has no dependency on that adapter or either provider.

Provider teardown retains the registration until tool admission stops and owned work and resources close. A grouped Cordis effect orders that cleanup; separate effects may dispose concurrently. Concurrent Sessions remain caller-coordinated because a provider registration does not own an observe, act, and verify workflow.

## Alternatives considered

**Unified action API.** A common screenshot, input, and window vocabulary would require translating provider-specific semantics without a current consumer that needs portability. Provider-owned tools preserve those semantics.

**Only external MCP.** This reuses an installed driver and its process identity but leaves a separate installation prerequisite. The native provider supplies a one-package runtime installation.

**Only embedded native runtime.** Native integration makes DSH own runtime lifecycle and shares native failures with its backend process. The MCP provider remains available for independently installed drivers.

**Session ownership broker.** Reserving a desktop across a whole workflow requires an explicit acquisition and release policy. The current service enforces provider registration only, leaving workflow coordination to callers.

## Consequences

The service remains independent of experimental packages. The public-release allowlist admits only the MCP provider without promoting its support status. Configuration selects a provider, and switching requires unloading the current provider first.

The Desktop and Lite bundles mount the native provider over the base bundle's `dsh-computer-use` row; the `dsh` installation and the Desktop payload carry the native provider in their production closures. No headless, web, ACP, or SDK profile selects a provider. The workspace-constraints gate rejects every experimental package in a release member's runtime dependency sections.

Native platform support and host permissions remain upstream and deployment responsibilities. On macOS the user grants desktop permissions to the launching application; Windows requires an interactive desktop session. macOS cursor-overlay hosting and dedicated Desktop permission UI are deferred. Cancellation stops waiting and propagates to the driver; it does not promise rollback of delivered desktop input.
