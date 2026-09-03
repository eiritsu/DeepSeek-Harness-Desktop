# Agent Note: Web profiles use one host compaction service

Status: implemented

English | [中文](2026-09-03-web-host-compaction.zh.md)

## Problem

The Web bundle disabled the three compaction rows while full Agent Presets mounted private copies. The resulting behavior depended on the selected preset: minimal sessions had no compaction at all, and each preset carried a separate threshold configuration even though model capacity is resolved by the shared LLM route.

## Decision

The Web profile mounts `compaction-basic`, `command-compact`, and `tool-result-pruner` on the host plane. The Web patch states their complete configuration, with automatic compaction enabled, a pressure threshold ratio of `0.8`, a retained-tail ratio of `0.16`, one compaction retry, one overflow retry, and the `8192/4096/1024` tool-result character budgets. `compaction-basic` resolves concrete token thresholds from the routed model's advertised `contextWindow`, so the same ratios produce model-sized budgets for every provider and model route. Web Agent Presets no longer duplicate these three rows.

## Alternatives considered

**Keep compaction in each preset.** Rejected because a session's compaction capability changed with its preset and minimal sessions could not recover an oversized context. The Web product requires one explicit capability for every session.

**Mount both host and preset copies.** Rejected because automatic listeners and tool-result pruning could run twice for one request, while two command registrations would create scope-dependent behavior.

**Use fixed token thresholds per model.** Rejected because model catalogs and user-declared routes carry their own capacities; fixed values would become stale and would not cover newly discovered models.

## Consequences

Every Web session, including minimal and custom preset sessions, has automatic pressure compaction, overflow recovery, model-free tool-result pruning, and `/compact`. The token meter remains host-owned and is shared by the single compaction service. Standalone profiles such as `sdk-minimal` remain independent and keep their own no-compaction contract.

## Testing

`apps/cli/tests/web-agent-presets.e2e.ts` boots the shipped Web composition and asserts the host compaction service configuration, context-window-scaled policy ratios, pruner configuration, `/compact` command, and availability through a minimal preset. The same replay keeps all preset tool and prompt assertions green.
