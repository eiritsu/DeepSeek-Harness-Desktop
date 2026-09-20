# Agent Note: Computer-use provider registration

Status: implemented

English | [中文](2026-09-12-computer-use-provider-registration.zh.md)

## Problem

Desktop providers expose different operations, observation formats, and platform facilities. DSH needs to prevent accidentally enabling two providers in one composition while allowing provider-specific integrations to work without committing to a common action API.

## Decision

The DSH capability is named **computer use**. [`dsh-computer-use`](../../../../packages/computer-use/computer-use/README.md) owns `ctx.computerUse`, which registers one provider-owned name and returns its effect disposer. A second registration fails regardless of its name. The service contains no provider object, shared operation type, dispatch method, Session lock, or runtime selector.

**Cua Driver** names the upstream implementation. The [native provider](../../../../packages/computer-use/cua-driver-native/README.md) is a release package that installs the upstream native npm dependency. The [MCP provider](../../../../packages/experimental/computer-use-cua-driver-mcp/README.md) connects an installed executable and remains experimental on the explicit public-release allowlist. The Desktop and Lite products mount the native provider by default; other profiles select a provider explicitly.

Each integration exposes the upstream tool catalog. MCP result conversion stays in `dsh-mcp-client`, whose callback-based tool adapter also converts native Cua Driver results. The computer-use service has no dependency on that adapter or either provider.

Provider teardown retains the registration until tool admission stops and owned work and resources close. A grouped Cordis effect orders that cleanup; separate effects may dispose concurrently. The native provider owns a durable `enabled` section through `ctx.settings.installSection`; the top-level **Computer Use** settings section contributed by [`dsh-client-ui-computer-use`](../../../../packages/client/ui-computer-use/README.md) is the user layer of that section, and its `enabled` composition field is the base layer. The browser half registers that section only while a composition serves the namespace, so it appears on late availability and retracts when the namespace goes away. Toggling it rebuilds the mount: a disable aborts pending calls, removes tools and guidance, awaits SDK shutdown, and releases the registration, while an enable imports native code, creates the runtime, and discovers tools again. One serialized controller orders those transitions, so a stop always precedes the start it supersedes. Concurrent Sessions remain caller-coordinated because a provider registration does not own an observe, act, and verify workflow.

## Alternatives considered

**Unified action API.** A common screenshot, input, and window vocabulary would require translating provider-specific semantics without a current consumer that needs portability. Provider-owned tools preserve those semantics.

**Only external MCP.** This reuses an installed driver and its process identity but leaves a separate installation prerequisite. The native provider supplies a one-package runtime installation.

**Only embedded native runtime.** Native integration makes DSH own runtime lifecycle and shares native failures with its backend process. The MCP provider remains available for independently installed drivers.

**Session ownership broker.** Reserving a desktop across a whole workflow requires an explicit acquisition and release policy. The current service enforces provider registration only, leaving workflow coordination to callers.

## Consequences

The service remains independent of experimental packages. The public-release allowlist admits only the MCP provider without promoting its support status. Configuration selects a provider, and switching requires unloading the current provider first. The native provider's `enabled` setting does not switch providers: it releases and retakes the same registration, so a composition that mounts a second provider still fails on the occupied slot.

The Desktop and Lite bundles mount the native provider over the base bundle's `dsh-computer-use` row; the `dsh` installation and the Desktop payload carry the native provider in their production closures. No headless, web, ACP, or SDK profile selects a provider. The [Desktop packaging smoke](../../../../apps/desktop/scripts/smoke-runtime.ts) boots the Host without an interactive desktop, so its profile overlay disables the native provider for that smoke only; installed Desktop and Lite applications keep it mounted by default. The workspace-constraints gate rejects every experimental package in a release member's runtime dependency sections.

Native platform support and host permissions remain upstream and deployment responsibilities. On macOS the user grants desktop permissions to the launching application; Windows requires an interactive desktop session. macOS cursor-overlay hosting and dedicated Desktop permission UI are deferred. Cancellation stops waiting and propagates to the driver; it does not promise rollback of delivered desktop input.
