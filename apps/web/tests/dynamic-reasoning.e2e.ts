// Web e2e scenario: current models.dev controls reach the custom route picker.
// The catalog fetch is stubbed with current upstream provider metadata; model
// selection only writes settings, so the scenario makes no model requests.
import { mkdir, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed, vi } from 'vitest'
import {
  captureStableAria, compareOrRefreshGolden, launchWebScaffold, watchConsole,
  webSnapshotMode, type WebScaffold,
} from './scaffold.ts'
import { ZH_BROWSER_LOCALE, connectFreshWorkspaceZh, saveFailureShot } from './support.ts'

const OVERLAY = fileURLToPath(new URL('./dynamic-reasoning.overlay.yml', import.meta.url))
const UI_EXPECTED = fileURLToPath(new URL('./expected/dynamic-reasoning/ui.expected.md', import.meta.url))
const MODE = webSnapshotMode()
const CATALOG = {
  models: {
    'minimax/MiniMax-M3': { id: 'minimax/MiniMax-M3', reasoning: true, modalities: { input: ['text'] }, limit: { context: 196_608, output: 65_536 } },
    'minimax/MiniMax-M3.1-Flash-Preview': { id: 'minimax/MiniMax-M3.1-Flash-Preview', reasoning: true, modalities: { input: ['text'] }, limit: { context: 196_608, output: 65_536 } },
  },
  providers: {
    'minimax-cn': {
      id: 'minimax-cn',
      api: 'https://api.minimax.cn/anthropic/v1',
      models: { 'MiniMax-M3': { reasoning: true, reasoning_options: [{ type: 'toggle' }] } },
    },
    'minimax-cn-coding-plan': {
      id: 'minimax-cn-coding-plan',
      api: 'https://api.minimax.cn/anthropic/v1',
      models: {
        'MiniMax-M3': { reasoning: true, reasoning_options: [{ type: 'toggle' }] },
        'MiniMax-M3.1-Flash-Preview': {
          canonical_model_id: 'minimax/MiniMax-M3.1-Flash-Preview',
          reasoning: true,
          reasoning_options: [{ type: 'effort', values: ['low', 'medium', 'high', 'xhigh', 'max'] }],
        },
      },
    },
  },
}

describe.skipIf(MODE === 'record')('web e2e: dynamic reasoning controls', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>
  let originalFetch: typeof globalThis.fetch
  let modelStreams = 0
  let stopModelStreamObservation: (() => void) | undefined

  beforeAll(async () => {
    originalFetch = globalThis.fetch
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = input instanceof Request ? input.url : input instanceof URL ? input.href : input
      if (url === 'https://models.dev/catalog.json?type=all') {
        return new Response(JSON.stringify(CATALOG), { headers: { 'content-type': 'application/json' } })
      }
      return originalFetch(input, init)
    })
    scaffold = await launchWebScaffold({ extraOverlayPath: OVERLAY })
    await scaffold.ctx.modelCatalog.refresh()
    expect(scaffold.ctx.modelCatalog.loaded).toBe(true)
    await scaffold.ctx.settings.update('llm-pi-ai', {
      providers: {
        'minimax-cn-custom': {
          displayName: 'MiniMax CN custom',
          api: 'openai-responses',
          baseURL: 'https://api.minimax.cn/v1',
          models: [{ id: 'MiniMax-M3' }, { id: 'MiniMax-M3.1-Flash-Preview' }],
        },
        'minimax-cn-anthropic': {
          displayName: 'MiniMax CN Anthropic',
          api: 'anthropic-messages',
          baseURL: 'https://api.minimax.cn/anthropic/v1',
          models: [{ id: 'MiniMax-M3' }, { id: 'MiniMax-M3.1-Flash-Preview' }],
        },
      },
    })
    stopModelStreamObservation = scaffold.ctx.on('llm/stream', (_options, next) => {
      modelStreams++
      return next()
    })
    const m31 = await scaffold.ctx.llm.resolveModelInfo('minimax-cn-custom', 'MiniMax-M3.1-Flash-Preview')
    expect(m31.reasoning?.efforts.map(effort => effort.id)).toEqual(['low', 'medium', 'high', 'xhigh', 'max'])
    const m3 = await scaffold.ctx.llm.resolveModelInfo('minimax-cn-anthropic', 'MiniMax-M3')
    expect(m3.reasoning?.control).toBe('toggle')

    browser = await chromium.launch()
    page = await browser.newPage({ viewport: { width: 1680, height: 1000 }, locale: ZH_BROWSER_LOCALE })
    tripwire = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    await connectFreshWorkspaceZh(page, scaffold.workspaceCwd)
  }, 120_000)

  afterAll(async () => {
    try {
      await browser?.close()
      await scaffold?.close()
    } finally {
      stopModelStreamObservation?.()
      vi.unstubAllGlobals()
    }
  })

  it('shows localized toggle and effort choices and persists them without model calls', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-dynamic-reasoning'))
    const trigger = page.getByRole('button', { name: /^选择模型/ })
    await trigger.waitFor({ timeout: 15_000 })

    await trigger.click()
    await page.getByRole('menuitem', { name: /推理/ }).click()
    const choices = page.getByRole('menuitemradio')
    await expect.poll(async () => choices.allTextContents(), { timeout: 10_000 })
      .toEqual(['Default', '关闭', '开启'])
    await mkdir(dirname(UI_EXPECTED), { recursive: true })
    await compareOrRefreshGolden(UI_EXPECTED, await captureStableAria(page, '[role="menu"]', scaffold.workspaceCwd), MODE)
    await choices.getByText('开启', { exact: true }).click()
    await expect.poll(() => scaffold.ctx.agentDefaultModel.currentSelection().reasoningEffort).toBe('on')
    await expect.poll(async () => readFile(join(scaffold.harnessHome, 'profiles', 'scaffold', 'cordis.patch.yml'), 'utf8'))
      .toContain('reasoningEffort: on')

    await trigger.click()
    await page.getByRole('menuitem', { name: /^推理(?:\s|$)/ }).click()
    await page.getByRole('menuitemradio', { name: '关闭', exact: true }).click()
    await expect.poll(() => scaffold.ctx.agentDefaultModel.currentSelection().reasoningEffort).toBe('off')
    await expect.poll(async () => readFile(join(scaffold.harnessHome, 'profiles', 'scaffold', 'cordis.patch.yml'), 'utf8'))
      .toContain('reasoningEffort: off')

    await trigger.click()
    await page.getByRole('menuitem', { name: /^推理(?:\s|$)/ }).click()
    await page.getByRole('menuitemradio', { name: 'Default', exact: true }).click()
    await expect.poll(() => scaffold.ctx.agentDefaultModel.currentSelection().reasoningEffort).toBeUndefined()
    await expect.poll(async () => readFile(join(scaffold.harnessHome, 'profiles', 'scaffold', 'cordis.patch.yml'), 'utf8'))
      .not.toContain('reasoningEffort:')

    await trigger.click()
    await page.getByRole('menuitem', { name: /模型/ }).click()
    await page.getByRole('group', { name: 'MiniMax CN custom', exact: true })
      .getByRole('menuitemradio', { name: 'MiniMax-M3.1-Flash-Preview', exact: true }).click()
    await trigger.click()
    await page.getByRole('menuitem', { name: /推理等级/ }).click()
    await expect.poll(async () => page.getByRole('menuitemradio').allTextContents(), { timeout: 10_000 })
      .toEqual(['Default', 'low', 'medium', 'high', 'xhigh', 'max'])
    await page.getByRole('menuitemradio', { name: 'max', exact: true }).click()
    await expect.poll(() => scaffold.ctx.agentDefaultModel.currentSelection().reasoningEffort).toBe('max')
    await expect.poll(async () => readFile(join(scaffold.harnessHome, 'profiles', 'scaffold', 'cordis.patch.yml'), 'utf8'))
      .toContain('reasoningEffort: max')
    expect(modelStreams).toBe(0)
    expect(tripwire.pageErrors).toEqual([])
  }, 60_000)
})
