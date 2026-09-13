# Agent Note: Lite startup readiness and credential recovery

Status: implemented

English | [中文](2026-09-13-lite-startup-readiness-and-credentials.zh.md)

## Problem

DeepSeek Harness Lite treated the `dsh web:` URL and a request to `/plugins/__dsh_ready` as two sequential readiness signals. The Web profile no longer registers that private route and emits its URL only after plugin loading has settled, so a healthy Node host returned 404 to the redundant probe while the shell remained on “waiting for plugin modules.” Legacy migration could also copy `.credentials.yaml` with group or world read permission, which the credential provider correctly rejects. A malformed credential file produced only the generic early-exit screen, leaving the recoverable cause visible only in the desktop log.

## Decision

The Swift runtime treats the authenticated `dsh web:` URL as the single host readiness signal and navigates the WebView without a second HTTP probe. This follows the Web profile's existing lifecycle guarantee and keeps the one-time authentication token reserved for the WebView request.

Legacy migration narrows a copied `.credentials.yaml` to mode `0600`. Credential validation remains owned by the Node provider and continues to fail loud. The desktop startup error recognizes unsafe-permission, non-mapping, and invalid-YAML diagnostics and reports only the file path, mode when applicable, and a recovery action; it never includes the credential value or arbitrary stderr text.

## Alternatives considered

**Restore `/plugins/__dsh_ready`.** A shell-specific route would duplicate the loader-settlement guarantee already associated with the URL announcement and could drift again when the shared Web profile changes.

**Probe the announced root URL before navigation.** The URL contains a one-time process token, so a probe could consume the authentication request intended for the WebView.

**Rewrite malformed credential files automatically.** A scalar or invalid YAML document does not identify the intended credential key reliably. Guessing could destroy user data or store a secret under the wrong provider; explicit backup and re-entry is recoverable.

## Consequences

Lite reaches the Web client as soon as the supported host startup signal appears and no longer waits for an unowned route. A copied legacy credential file satisfies the provider's owner-only permission requirement. Invalid credential content still prevents startup until the operator repairs or moves the file, but the app now presents a safe, actionable explanation. Swift tests pin URL-driven readiness, permission narrowing, and redaction of credential diagnostics.
