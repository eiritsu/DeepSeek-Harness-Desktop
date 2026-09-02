# Agent Note: Tool-call compatibility defaults and display metadata

Status: implemented

English | [中文](2026-09-02-tool-call-compatibility.zh.md)

## Problem

PTC-only sessions expose `run_code` as the only callable transport. Models that follow a native tool schema, or that omit the UI-only `description` field on `bash`, `pwsh`, or `run_code`, receive harness argument errors before the requested operation runs. This turns presentation metadata and a selected agent preset into avoidable execution failures.

## Decision

The shipped `ptc` agent preset presents both native tool schemas and `run_code`. Native calls remain available for ordinary models and direct image, file, and shell operations; `run_code` remains available for batched SDK dispatch. The `tools:ptc-only` instruction is empty in `both`, so the prompt does not claim that native names are forbidden.

The `description` parameter on `bash`, `pwsh`, and `run_code` is optional. The executors preserve rejection of an explicitly blank description, while an omitted value receives a deterministic presentation label (`Run bash command`, `Run PowerShell command`, or `Run code`). The labels are UI metadata and do not alter command, program, or result semantics.

## Alternatives considered

**Keep the preset PTC-only and rely on model self-correction.** Rejected because the model must first receive an error for a tool name it was shown in surrounding guidance, and some providers repeatedly emit direct calls. Keeping native schemas removes that protocol mismatch without removing the batching transport.

**Continue requiring descriptions and improve prompt wording.** Rejected because `description` is display metadata, not an execution precondition. A missing optional label must not block a valid command or program; explicit blank labels remain invalid to catch malformed authored input.

**Derive labels from command or source text.** Rejected because commands and code can contain secrets or unrelated user content. Fixed generic labels provide stable cards without copying executable text into UI metadata.

## Consequences

Both native schemas and the generated SDK add prompt tokens for the `ptc` preset, trading a larger request prefix for compatibility with models that do not reliably synthesize nested calls. Tool cards remain readable when models omit display metadata, and shell/program execution no longer fails solely because a presentation field is absent. Focused tests cover schema optionality, fallback execution and presentation, and the preset's native-plus-PTC assembly.
