/**
 * Lite distribution package lists. The `desktop-lite` profile mounts
 * `@deepseek-ai/dsh-client-ui-computer-use` as the Computer Use settings
 * section, so the distribution build must ship its built `lib`, record it in
 * the RuntimeManifest, and audit it in the DMG source snapshot.
 */

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const COMPUTER_USE_PACKAGE = 'packages/client/ui-computer-use'
const COMPUTER_USE_PACKAGE_NAME = '@deepseek-ai/dsh-client-ui-computer-use'

/** Repository root, from `packages/bundle/desktop-lite/tests`. */
const repositoryRoot = new URL('../../../../', import.meta.url)

function readRepositoryFile(relativePath: string): string {
  return readFileSync(new URL(relativePath, repositoryRoot), 'utf8')
}

function extractList(source: string, pattern: RegExp, label: string): string {
  const match = pattern.exec(source)
  if (match?.[1] === undefined) throw new Error(`${label}: package list not found`)
  return match[1]
}

describe('Lite distribution package lists', () => {
  it('mounts the Computer Use settings section from the desktop-lite profile', () => {
    const profile = readRepositoryFile('packages/bundle/desktop-lite/cordis.patch.yml')
    expect(profile).toContain(`name: '${COMPUTER_USE_PACKAGE_NAME}'`)
  })

  it('records the Computer Use client package in the RuntimeManifest package paths', () => {
    const build = readRepositoryFile('desktop-shell/scripts/build-app.sh')
    const packagePaths = extractList(build, /const packagePaths = \[([\s\S]*?)\n\]/u, 'build-app.sh')
    expect(packagePaths).toContain(`'${COMPUTER_USE_PACKAGE}'`)
  })

  it('requires the built Computer Use client package before packaging', () => {
    const build = readRepositoryFile('desktop-shell/scripts/build-app.sh')
    const artifactChecks = extractList(build, /for PACKAGE in \\\n([\s\S]*?)\n\s*do/u, 'build-app.sh')
    expect(artifactChecks).toContain(COMPUTER_USE_PACKAGE)
  })

  it('audits the Computer Use client package in the DMG distribution', () => {
    const dmg = readRepositoryFile('desktop-shell/scripts/package-dmg.sh')
    const audit = extractList(dmg, /for PACKAGE in \\\n([\s\S]*?)\n\s*do/u, 'package-dmg.sh')
    expect(audit).toContain(COMPUTER_USE_PACKAGE)
  })
})
