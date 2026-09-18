# Agent Note: Lite window hit testing and dynamic reset

Status: implemented

English | [中文](2026-09-18-lite-window-and-dynamic-reset.zh.md)

## Problem

The Lite titlebar overlay could intercept WebKit toolbar clicks because it lived in the native titlebar container. After a DSH connection reset, the browser could also keep dynamic package state from the previous Host process and send calls for plugin IDs that no longer existed.

## Decision

The Lite drag view now lives in the content hierarchy as a full-width, fixed-height overlay. It claims only its safe drag frame; other points fall through to WebKit. The frame keeps native drag, double-click zoom, and width-adaptive exclusion behavior.

The Client dynamic package runner and run orchestrator now reset page-local packages, approvals, failures, and in-flight generation state on `connection/reset`. Late work from the previous connection cannot answer or publish after the reset.

## Alternatives considered

**Keep the overlay in the native titlebar and enlarge exclusion rectangles.** Rejected because parent hit testing can still swallow events before WebKit receives them.

**Retain dynamic packages across reconnects.** Rejected because Plugin IDs are process-local and the new Host may not contain the old registry entries.

## Verification

Swift package tests pass, including Lite titlebar geometry tests. Client runner and orchestrator tests cover reset teardown, future reloads, and suppression of late answers.

## Consequences

Toolbar controls remain interactive while the titlebar still supports dragging and zooming. A reconnect clears transient dynamic UI state; the authoritative Host inventory is read again by the existing inventory reset path.
