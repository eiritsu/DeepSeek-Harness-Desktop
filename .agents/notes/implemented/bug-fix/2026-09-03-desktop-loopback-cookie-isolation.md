# Agent Note: Isolate desktop loopback browser cookies

Status: implemented

English | [中文](2026-09-03-desktop-loopback-cookie-isolation.zh.md)

## Problem

The desktop shell reuses loopback ports across launches, while shared URL-session and WebView cookie stores retain cookies keyed by the loopback host. The accumulated cookies can exceed the local server's request-header limit and return HTTP 431 before the Web profile or its client bundles are read, leaving the desktop window blank.

## Decision

The readiness probe uses an ephemeral URL session with cookie storage disabled because `/plugins/__dsh_ready` is unauthenticated and must not consume browser-session state. The WebView uses a non-persistent website data store, so each app run has an isolated browser session while retaining cookies minted during that run for the one-time launch-token exchange. Update health checks use a fresh ephemeral session rather than the process-wide shared session.

## Alternatives considered

**Clear the shared cookie store on every launch.** Clearing global storage could delete data owned by other local Web clients and still leaves the desktop shell dependent on shared mutable state.

**Increase the local server's header limit.** A larger limit hides unbounded stale-cookie accumulation and does not remove cross-run session contamination.

**Keep persistent WebView storage and rotate only the launch URL.** The launch token changes, but stale cookies remain attached to later dynamic loopback ports and can still prevent the root request from reaching authentication.

## Consequences

The desktop health probe and embedded WebView no longer inherit cookies from previous loopback ports, preventing the HTTP 431 blank-window failure. Cookies issued during one run remain available to that run's WebView for authenticated API requests. Durable sessions, settings, credentials, plugins, and Skills remain owned by the desktop data store; browser session data is intentionally per-run.

The focused Swift suite verifies the WebView data-store policy, launch-token URL handling, readiness polling, and startup lifecycle. A distribution cold start was run from the rebuilt App bundle: the Web profile rendered its sidebar and composer, and `/plugins/__dsh_ready` returned HTTP 204.
