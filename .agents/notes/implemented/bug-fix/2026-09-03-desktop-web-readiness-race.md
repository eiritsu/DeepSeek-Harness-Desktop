# Agent Note: Wait for the desktop Web bundle before opening the WebView

Status: implemented

English | [中文](2026-09-03-desktop-web-readiness-race.zh.md)

## Problem

The desktop runtime printed its loopback URL as soon as the HTTP listener bound. The client module registry could still be composing its first combo response, so the WebView sometimes requested that URL during the short 404 window and permanently showed a failed plugin boot screen.

## Decision

After the runtime announces its URL, the desktop shell polls the authenticated boot page, extracts an advertised combo URL, and waits until that bundle returns HTTP 200 before handing the URL to WKWebView. The wait is bounded and reports a clear startup failure if the registry never becomes ready.

## Alternatives considered

**Add a fixed sleep before loading the WebView.** A fixed delay is either unnecessarily slow on fast machines or too short under load and does not observe the actual readiness condition.

**Retry only after the WebView displays an error.** The module loader has already lost its initial boot state by then; delaying navigation until the server advertises a valid bundle keeps the failure out of the UI.

## Consequences

The first desktop navigation now starts only after the server has published both its boot HTML and at least one client combo. The probe uses the same authenticated loopback URL and follows the same revisioned `/plugins/??...&rev=...` resource advertised to the browser. Startup can take a few hundred milliseconds longer while the registry composes, but transient bundle 404s no longer become permanent plugin-load failures.

Native tests cover HTML entity decoding for advertised combo URLs; the existing Swift suite remains the focused lifecycle and packaging gate.
