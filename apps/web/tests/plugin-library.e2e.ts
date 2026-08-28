// Web e2e scenario: the desktop-only plugin-library entry and installed view.
// The real shipped Web composition starts with a document-start bridge that
// mirrors WKWebView's capability signal; all replies stay keyless and local.
import { fileURLToPath } from 'node:url'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import { join } from 'node:path'
import {
  assertFixtureInventory, captureStableAria, compareOrRefreshGolden,
  launchWebScaffold, watchConsole, webSnapshotMode, type WebScaffold,
} from './scaffold.ts'
import { ZH_BROWSER_LOCALE, saveFailureShot } from './support.ts'

const SNAPSHOT_DIR = fileURLToPath(new URL('./expected/plugin-library', import.meta.url))
const INSTALLED_EXPECTED = join(SNAPSHOT_DIR, 'installed.expected.md')
const MODE = webSnapshotMode()

type DesktopBridgeRequest = { readonly action: string }

describe('web e2e: desktop plugin library', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    scaffold = await launchWebScaffold({})
    browser = await chromium.launch()
    page = await browser.newPage({ viewport: { width: 1680, height: 1000 }, locale: ZH_BROWSER_LOCALE })
    await page.addInitScript(() => {
      const bridge = {
        async request(input: DesktopBridgeRequest): Promise<unknown> {
          if (input.action === 'list') {
            return {
              plugins: [{
                name: '@fixture/dsh-desktop-plugin',
                displayName: 'Fixture desktop plugin',
                version: '1.2.3',
                latestVersion: '1.3.0',
                removable: true,
              }],
            }
          }
          if (input.action === 'logs') return { records: [] }
          if (input.action === 'catalog') return { plugins: [], hasMore: false }
          if (input.action === 'thirdPartyCatalog') {
            return { plugins: [], hasMore: false, total: 0, catalogTotal: 0, categories: [] }
          }
          throw new Error(`unexpected desktop bridge action: ${input.action}`)
        },
      }
      Object.defineProperty(window, 'dshDesktopPluginBridge', {
        value: bridge,
        configurable: false,
        enumerable: false,
        writable: false,
      })
    })
    tripwire = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it('mounts the native entry and renders the profile dependency inventory', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-plugin-library-installed'))
    const trigger = page.getByRole('button', { name: '插件库', exact: true })
    await trigger.waitFor({ timeout: 10_000 })
    expect(await trigger.getAttribute('aria-expanded')).toBe('false')
    await trigger.click()

    const overlay = page.locator('[data-plugin-library-overlay]')
    await overlay.getByText('Fixture desktop plugin', { exact: true }).waitFor({ timeout: 10_000 })
    await expect.poll(() => overlay.getAttribute('aria-busy'), { timeout: 5_000 }).not.toBe('true')
    expect(await trigger.getAttribute('aria-expanded')).toBe('true')
    const snapshot = await captureStableAria(page, '[data-plugin-library-overlay]', scaffold.workspaceCwd)
    await compareOrRefreshGolden(INSTALLED_EXPECTED, snapshot, MODE)
    expect(tripwire.pageErrors).toEqual([])
  }, 60_000)

  it.skipIf(MODE === 'record')('keeps its snapshot inventory closed', async () => {
    await assertFixtureInventory(SNAPSHOT_DIR, ['installed.expected.md'])
  })
})
