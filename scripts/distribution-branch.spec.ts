import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const buildScript = readFileSync(new URL('../desktop-shell/scripts/build-app.sh', import.meta.url), 'utf8')
const packageScript = readFileSync(new URL('../desktop-shell/scripts/package-dmg.sh', import.meta.url), 'utf8')
const releaseBranch = 'release/0.1.21'

describe('Lite distribution source branch', () => {
  it('checks the published head and embeds the same update branch that the DMG validates', () => {
    expect(buildScript).toContain(`RELEASE_SOURCE_BRANCH="${releaseBranch}"`)
    expect(buildScript).toContain('require_published_head "$SOURCE_ROOT" desktop-publish "$RELEASE_SOURCE_BRANCH" "Harness"')
    expect(buildScript).toContain('Set :DSHSourceBranch $RELEASE_SOURCE_BRANCH')
    expect(packageScript).toContain(`RELEASE_SOURCE_BRANCH="${releaseBranch}"`)
    expect(packageScript).toContain('!= "$RELEASE_SOURCE_BRANCH"')
  })
})
