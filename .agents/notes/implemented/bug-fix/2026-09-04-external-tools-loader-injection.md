# Agent Note: preserve Loader injection metadata for external-tools

Status: implemented

English | [中文](2026-09-04-external-tools-loader-injection.zh.md)

## Problem

`dsh-external-tools` is a namespace plugin exporting `name`, `inject`, and `apply`. When the module also provides a default export, the DSH Loader unwraps the module to that default value and drops the injection metadata. With no credential configured, the external-tool registration path does not read `ctx.tools`, so the defect appears only after the first API key is saved.

## Decision

`dsh-external-tools` keeps only its namespace-plugin exports and has no default export. A Loader regression test runs the real `unwrapExports` path and checks that `name`, `inject`, and `apply` remain present. The Host plugin therefore activates with both `tools` and `credentials` injected, and saving a credential can register the corresponding tool without breaking the runtime connection.

## Alternatives considered

**Add static `inject` to the default class.** Rejected because Loader would still discard the namespace's other metadata and the package would expose two entry semantics; one namespace entry is explicit.

**Catch a missing `ctx.tools` inside `reconcile()`.** Rejected because it would disguise a Loader composition error as credential state, leave the tool unregistered, and repeat the failure later. The injection metadata must be fixed at the module export shape.

## Consequences

After saving a Tavily or other external-tool credential, the Host remains live and registers the implemented provider tool; the browser credential refresh receives a normal response. New namespace plugins must avoid a default export that triggers Loader unwrapping, and a Loader-path test keeps that rule executable.
