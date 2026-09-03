# Agent Note: Desktop Application Support data and plugin management

Status: implemented

English | [中文](2026-09-03-desktop-application-support-data-and-plugin-management.zh.md)

## Problem

The macOS desktop shell uses an Application Support Harness home, while earlier desktop runs stored durable data in `~/.dsh`. The desktop plugin library also reported only profile dependencies, so shipped plugin and Skill bundles were absent from its installed count even when the app loaded them.

## Decision

The desktop shell owns `~/Library/Application Support/DeepSeek Harness Desktop/data` for sessions, settings, profiles, plugin dependencies, and Skill data. On first launch, it merges missing legacy data from `~/.dsh`, gives legacy settings and workspace state precedence over the fresh onboarding files, preserves the old directory, and records a migration marker for idempotence.

The shell initializes `data/dsh-desktop.sqlite` before runtime startup. The database stores the schema version, a complete inventory of legacy durable files, and destination tables for settings, credentials, workspaces, sessions, profiles, plugins, skills, model catalogs, audit records, and source releases. Sessions, settings, credentials, storage units, profile/Skill metadata, plugin audit records, and source-release records use SQLite at runtime. Profile manifests and Skill source remain executable file artifacts; the legacy audit JSONL remains only as a compatibility export.

The desktop plugin library lists shipped Web profile bundles as app-managed entries and lists external profile dependencies as removable entries. New external installs continue to use `dsh plugin --profile web` with `DSH_HOME` set to the Application Support data directory. Startup adds shipped bundles that are present in the embedded source snapshot to the persistent Web profile without replacing user dependencies.

## Verification

The desktop Swift test suite covers legacy-home merging without deletion and app-managed bundle inventory. The plugin-library locale and package documentation describe the Application Support ownership and the distinction between built-in and removable entries.

## Alternatives considered

Keeping `~/.dsh` as the desktop home would preserve the old path but would mix desktop-owned runtime files with other Harness invocations and would not provide an app-owned location for managed plugins. Deleting the legacy home during migration would risk irreversible loss, so the migration copies and retains it.

## Consequences

Replacing the app binary no longer requires users to move plugin or Skill data manually. The legacy home remains as a recovery copy; later writes through the desktop UI do not update it. App-managed bundles cannot be removed from the external-plugin workflow, while external dependencies remain subject to the existing review and audit path.
