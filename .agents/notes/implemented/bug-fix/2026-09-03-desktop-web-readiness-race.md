# Agent Note: Wait for the desktop Web bundle before opening the WebView

Status: implemented

English | [中文](2026-09-03-desktop-web-readiness-race.zh.md)

## Problem

The desktop runtime printed its loopback URL as soon as the HTTP listener bound. The client module registry could still be composing its first combo response, so the WebView sometimes requested that URL during the short 404 window and permanently showed a failed plugin boot screen.

## Decision

After the runtime announces its URL, the desktop shell polls an unauthenticated readiness route owned by the client-module registry before handing the one-time-token URL to WKWebView. The wait is bounded and reports a clear startup failure if the registry never becomes ready.

## Alternatives considered

**Add a fixed sleep before loading the WebView.** A fixed delay is either unnecessarily slow on fast machines or too short under load and does not observe the actual readiness condition.

**Retry only after the WebView displays an error.** The module loader has already lost its initial boot state by then; delaying navigation until the server advertises a valid bundle keeps the failure out of the UI.

## Consequences

The first desktop navigation now starts only after the client-module route has been registered and its composed bundle responses are available. The probe calls `/plugins/__dsh_ready` without the process token, preserving the one-time token for WKWebView's cookie exchange. Startup can take a few hundred milliseconds longer while the registry composes, but transient bundle 404s no longer become permanent plugin-load failures.

Native tests cover the token-free readiness URL and the client-module readiness route; the existing Swift suite remains the focused lifecycle and packaging gate.
