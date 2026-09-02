# Agent Note: Keep plugin removal independent of release-age resolution

Status: implemented

English | [中文](2026-09-02-pnpm-remove-policy-bypass.zh.md)

## Problem

The desktop plugin library could not remove an installed package when pnpm's default `minimumReleaseAge` policy was active. pnpm 11 entered dependency resolution for the manifest-only removal, then failed with `ERR_PNPM_RESOLUTION_POLICY_VIOLATIONS_UNHANDLED` because the remove path did not provide the policy callback it expected.

## Decision

The desktop shell invokes `dsh plugin --profile web remove` with `--config.minimum-release-age=0`. Removal only deletes an already selected dependency and reconciles the profile bundle list; it does not select or install a new package. Disabling the release-age check for this operation avoids pnpm's remove-only internal failure while leaving the policy enabled for installation and update operations.

## Alternatives considered

**Disable `minimumReleaseAge` in the profile workspace configuration.** Rejected because it would weaken the supply-chain policy for installs and updates, not just the operation that needs no new package selection.

**Edit `package.json`, `pnpm-lock.yaml`, and `node_modules` directly.** Rejected because pnpm owns dependency graph reconciliation, lockfile updates, and hoisted links; duplicating those operations in the desktop shell would create a second package-manager implementation.

**Upgrade or pin a different pnpm version.** Rejected because the packaged shell deliberately uses its pinned pnpm runtime, and the failure is isolated to a policy callback path rather than a package-specific incompatibility.

## Consequences

Removing a plugin from the desktop library now reaches pnpm's normal package removal and bundle reconciliation even when the release-age policy is configured. The shell still uses the full policy for every operation that can introduce or select package versions, and the profile lockfile remains the package manager's source of truth.
