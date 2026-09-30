# Agent Note: Plugin catalog install navigation

Status: implemented

English | [中文](2026-10-01-plugin-catalog-install-navigation.zh.md)

## Problem

An installed catalog can hand a package spec to the Web Plugin Manager, but its existing navigation API only opens bundle details. Closing the catalog after selection leaves the user without an install dialog for the selected package.

## Decision

`pluginNavigation.openInstall(spec)` selects the Plugins panel, returns its navigation store to the list, and opens the install dialog with the trimmed spec. A caller without a spec uses the existing `PluginManagerFace.openInstall()` action, which keeps the official add button's empty input and analytics event.

An active install keeps its spec and progress when another caller supplies a spec. An idle dialog may be replaced because the Host has not received an install request. A no-argument call continues to reopen a hidden task or preserve the existing dialog state.

## Alternatives considered

**Let the catalog own an independent install dialog.** Rejected because registry choice, Host inspection, cancellation, progress, and recovery belong to the Plugin Manager's existing install flow.

**Navigate only to the Plugins list and ask the user to enter the spec again.** Rejected because the catalog already has the selected package identity and can hand it directly to the manager.

## Consequences

Catalog selection reaches the official Host-backed install flow with one navigation action. The navigation API remains specific to installing a supplied spec; existing bundle navigation and the no-argument add action retain their behavior.

## Testing

Manager-store tests cover trimmed prefill, the no-argument add action, replacing an idle dialog, and retaining an active installation. Browser-plugin coverage checks panel selection, list navigation, and the prefilled idle install state.
