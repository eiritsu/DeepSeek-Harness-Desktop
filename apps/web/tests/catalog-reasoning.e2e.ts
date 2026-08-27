// Web e2e scenario: every model route receives the same reasoning controls.
import { fileURLToPath } from 'node:url'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import { createMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import * as ModelCatalog from '@deepseek-ai/dsh-model-catalog'
import {
  assertFixtureInventory, captureStableAria, compareOrRefreshGolden,
  launchWebScaffold, watchConsole, webSnapshotMode, type WebScaffold,
} from './scaffold.ts'
import { ZH_BROWSER_LOCALE, connectFreshWorkspaceZh, saveFailureShot } from './support.ts'

const CATALOG = `data:application/json,${encodeURIComponent(JSON.stringify({
  xai: { models: {
    'grok-4.6': {
      reasoning: true,
      reasoning_options: [{ type: 'effort', values: ['low', 'medium', 'high', 'xhigh'] }],
      limit: { context: 1_000_000, output: 131_072 },
    },
  } },
  requesty: { models: {
    'grok-4.6': {
      reasoning: true,
      reasoning_options: [{ type: 'effort', values: ['none', 'low', 'medium', 'high', 'max'] }],
    },
  } },
}))}`
const OVERLAY = fileURLToPath(new URL('./catalog-reasoning.overlay.yml', import.meta.url))
const SNAPSHOT_DIR = fileURLToPath(new URL('./snapshots/catalog-reasoning', import.meta.url))
const UI_EXPECTED = fileURLToPath(new URL('./snapshots/catalog-reasoning/ui.expected.md', import.meta.url))
const CAPACITY_EXPECTED = fileURLToPath(new URL('./snapshots/catalog-reasoning/capacity.expected.md', import.meta.url))
const MODE = webSnapshotMode()

describe.skipIf(MODE === 'record')('web e2e: standard reasoning reaches the composer', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    scaffold = await launchWebScaffold({ extraOverlayPath: OVERLAY })
    await scaffold.ctx.plugin(ModelCatalog, { catalogURL: CATALOG, refreshIntervalMs: 60_000 })
    await scaffold.ctx.settings.update(settingsNamespace('llm-pi-ai'), {
      providers: {
        a6: {
          displayName: 'A6',
          api: 'openai-responses',
          baseURL: 'https://gateway.a6.example/v1',
          models: [{ id: 'grok-4.6', name: 'grok-4.6' }],
        },
      },
    })
    const model = await scaffold.ctx.llm.resolveModelInfo('a6', 'grok-4.6')
    if (model.context === undefined) throw new Error('catalog capacity did not reach exact model resolution')
    browser = await chromium.launch()
    page = await browser.newPage({ viewport: { width: 1680, height: 1000 }, locale: ZH_BROWSER_LOCALE })
    tripwire = watchConsole(page)
    await page.goto(scaffold.baseUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    await connectFreshWorkspaceZh(page, scaffold.workspaceCwd)
    const created = await scaffold.ctx.apiProxy.sessions.create({
      rpcId: 'catalog-capacity-create' as never,
      payload: { sessionId: SessionId('catalog-capacity-web-e2e'), cwd: scaffold.workspaceCwd },
    })
    if (!created.result.ok) throw new Error(`session.create failed: ${created.result.error.message}`)
    const session = scaffold.ctx.sessions.get(SessionId(created.result.value.sessionId))
    if (session === undefined) throw new Error('created catalog-capacity session is not live')
    session.append('turn/start', { turn: 1 })
    const user = session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'Confirm the current catalog capacity.' }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    session.append('session/title', {
      title: 'Catalog capacity',
      messageSeqs: [user.seq],
      source: { kind: 'fallback' },
    })
    session.append('step/start', { turn: 1, step: 1 })
    session.append('request/header', {
      header: { config: { provider: 'a6', model: 'grok-4.6' } },
      reason: 'initial',
    })
    session.append('request/context', {
      provider: 'a6',
      model: 'grok-4.6',
      contextWindow: model.context.contextWindow,
    })
    session.append('assistant/message', {
      turn: 1,
      step: 1,
      message: createMessage({
        role: 'assistant',
        content: [{ type: 'text', text: 'Capacity loaded.' }],
        source: { kind: 'model', provider: 'a6', model: 'grok-4.6' },
      }),
      usage: { inputTokens: 67_900, outputTokens: 20 },
    }, { surfaceOp: 'append' })
    session.append('step/end', { turn: 1, step: 1 })
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    await scaffold.ctx.sessions.flush(session)
    await page.reload({ waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    const ungrouped = page.getByText('未分组', { exact: true })
    if (await ungrouped.isVisible()) await ungrouped.click()
    await page.getByText('Catalog capacity', { exact: true }).waitFor({ timeout: 15_000 })
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it('offers the same five choices independently of catalog declarations', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-catalog-reasoning'))
    const trigger = page.getByRole('button', { name: /^选择模型/ })
    await trigger.waitFor({ timeout: 15_000 })
    await trigger.click()
    await page.getByRole('menuitem', { name: /推理等级/ }).click()

    const levels = page.getByRole('menuitemradio')
    await expect.poll(async () => levels.allTextContents(), { timeout: 10_000 })
      .toEqual(['Default', 'Off', 'Low', 'High', 'Max'])
    const snapshot = await captureStableAria(page, '[role="menu"]', scaffold.workspaceCwd)
    await compareOrRefreshGolden(UI_EXPECTED, snapshot, MODE)
    expect(tripwire.pageErrors).toEqual([])
  }, 60_000)

  it('renders the refreshed one-million-token capacity in the Web context meter', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-catalog-capacity'))
    await page.keyboard.press('Escape')
    await page.getByText('Catalog capacity', { exact: true }).click()
    const trigger = page.getByRole('button', { name: /上下文已用/ })
    await trigger.waitFor({ timeout: 15_000 })
    await trigger.click()
    const panel = page.getByRole('dialog', { name: '上下文已用' })
    await panel.waitFor({ timeout: 10_000 })
    await expect.poll(() => panel.textContent()).toContain('/ 1M')
    const snapshot = await captureStableAria(page, '[role="dialog"]', scaffold.workspaceCwd)
    await compareOrRefreshGolden(CAPACITY_EXPECTED, snapshot, MODE)
    expect(tripwire.pageErrors).toEqual([])
  }, 60_000)

  it('keeps its snapshot inventory closed', async () => {
    await assertFixtureInventory(SNAPSHOT_DIR, ['capacity.expected.md', 'ui.expected.md'])
  })
})
