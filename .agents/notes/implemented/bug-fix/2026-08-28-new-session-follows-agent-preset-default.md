# Agent Note: New Session follows the current agent-preset default

Status: implemented

English | [中文](2026-08-28-new-session-follows-agent-preset-default.zh.md)

## Problem

The Web New Session action may reuse a blank Session for the selected Workspace. That policy compared only Workspace identity and archive state, so a blank Session created under `code` or `standard` remained eligible after the user changed the default to `ptc`. The reused Session retained its original header preset and the UI still showed `code`. After the shipped preset id changed from `code` to `ptc`, resuming such a Session also failed because the current roster no longer contains `code`.

## Decision

Workspace navigation reads the current default from the Host agent-preset roster before choosing a reusable blank Session. A blank is reusable only when its `agentPreset` projection equals that default. The complete decision runs inside the existing per-Workspace single-flight, so concurrent New Session gestures share one roster read and one create rather than creating duplicates. If the roster cannot provide a default, only a blank whose projection is likewise absent can be reused; a Session with a recorded preset is never adopted under an unknown default.

The `agentPreset` Session projection maps the retired durable id `code` to `ptc` from both creation headers and selection events. This is a narrow durable-record alias, not acceptance of `code` in current configuration or roster APIs. Its projection state version advances so cached values are recomputed. This amends the durable-session consequence of the [PTC rename decision](../architecture/2026-08-25-rename-code-mode-to-ptc.md) while keeping current config identifiers strict.

## Verification

Projection tests cover legacy creation headers and selection events. Workspace navigation tests cover matching reuse, mismatched creation, default changes, roster failure, and concurrent calls. The Host and contract typechecks ensure the roster projection remains part of the generated Client surface.

## Alternatives considered

**Change the preset on every reusable blank Session.** Rejected because reuse would mutate a durable Session as a side effect of navigation and would still need failure recovery for recomposition.

**Accept `code` everywhere as a current preset id.** Rejected because configuration and authoring should expose only the current `ptc` identifier; compatibility is needed only where pre-rename Session records already carry the old id.

**Never reuse blank Sessions.** Rejected because the established Workspace flow deliberately preserves drafts and provisional rows. Matching the preset keeps that behavior without overriding the user's new default.

## Consequences

Changing the default affects the next New Session even when an older blank exists in the same Workspace. The older blank remains durable and can still be opened directly. Existing Session records carrying `code` resume as PTC without rewriting their event log or changing `SESSION_FORMAT_VERSION`.
