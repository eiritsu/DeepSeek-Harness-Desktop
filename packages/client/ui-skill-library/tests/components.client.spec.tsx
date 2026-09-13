// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SkillLibraryController } from '../src/client/controller.ts'
import { SkillLibraryOverlay } from '../src/client/SkillLibraryOverlay.tsx'
import type { SkillLibraryOverlayProps } from '../src/client/SkillLibraryOverlay.tsx'
import { SkillLibraryTrigger } from '../src/client/SkillLibraryTrigger.tsx'
import type { SkillLibraryTriggerProps } from '../src/client/SkillLibraryTrigger.tsx'
import type { SkillHubBridge } from '../src/client/bridge.ts'
import { en, type SkillLibraryLocaleKey } from '../src/client/locales.ts'

afterEach(() => { cleanup() })

const t = ((key: SkillLibraryLocaleKey, values?: Record<string, unknown>): string => {
  let result: string = en[key]
  for (const [name, value] of Object.entries(values ?? {})) result = result.replace(`{${name}}`, String(value))
  return result
}) as SkillLibraryOverlayProps['t']

function overlay(bridge: SkillHubBridge, controller = new SkillLibraryController()) {
  controller.show()
  const props = { bridge, controller, t, close: () => {} } as unknown as SkillLibraryOverlayProps
  return { controller, props, view: render(<SkillLibraryOverlay {...props} />) }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((accept, decline) => { resolve = accept; reject = decline })
  return { promise, resolve, reject }
}

describe('SkillLibraryTrigger', () => {
  it('opens from both the wide sidebar and compact rail', () => {
    const controller = new SkillLibraryController()
    const wide = render(<SkillLibraryTrigger {...({ wide: true, controller, t } as unknown as SkillLibraryTriggerProps)} />)
    expect(screen.getByText(en.trigger)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: en.trigger }))
    expect(screen.getByRole('button', { name: en.trigger }).getAttribute('aria-expanded')).toBe('true')
    wide.rerender(<SkillLibraryTrigger {...({ wide: false, controller, t } as unknown as SkillLibraryTriggerProps)} />)
    expect(screen.queryByText(en.trigger)).toBeNull()
  })
})

describe('SkillLibraryOverlay', () => {
  it('stays absent while closed', () => {
    const controller = new SkillLibraryController()
    const bridge = { request: vi.fn() } as unknown as SkillHubBridge
    const { container } = render(<SkillLibraryOverlay {...({ bridge, controller, t } as unknown as SkillLibraryOverlayProps)} />)
    expect(container.firstChild).toBeNull()
  })

  it('lists, filters, switches views, removes skills, and renders passive tabs', async () => {
    const request = vi.fn(async (input: { action: string }) => {
      if (input.action === 'listSkills') return { skills: ['office-reader', 'browser-search'] }
      if (input.action === 'removeSkill') return { ok: true }
      throw new Error('unexpected request')
    })
    const test = overlay({ request } as unknown as SkillHubBridge)
    await waitFor(() => { expect(screen.getByText('office-reader')).toBeTruthy() })
    fireEvent.change(screen.getByRole('searchbox', { name: en.installed }), { target: { value: 'missing' } })
    expect(screen.getByText(en.empty)).toBeTruthy()
    fireEvent.change(screen.getByRole('searchbox', { name: en.installed }), { target: { value: 'OFFICE' } })
    expect(screen.getByText('office-reader')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: en.compact }))
    fireEvent.click(screen.getByRole('button', { name: en.detailed }))
    fireEvent.click(screen.getByRole('button', { name: en.remove }))
    await waitFor(() => { expect(request).toHaveBeenCalledWith({ action: 'removeSkill', name: 'office-reader' }) })
    fireEvent.click(screen.getByRole('button', { name: en.review }))
    expect(screen.getByText(en.reviewEmpty)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: en.logs }))
    expect(screen.getByText(en.logsEmpty)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: en.close }))
    expect(test.controller.getSnapshot()).toBe(false)
  })

  it('renders an empty installed list and non-Error bridge failures', async () => {
    const empty = overlay({ request: vi.fn(async () => ({ skills: [] })) } as unknown as SkillHubBridge)
    await waitFor(() => { expect(screen.getByText(en.installedEmpty)).toBeTruthy() })
    empty.view.unmount()

    overlay({ request: vi.fn(async () => { throw 'native offline' }) })
    await waitFor(() => { expect(screen.getByRole('alert').textContent).toContain('native offline') })
  })

  it('reports removal failures without losing the installed item', async () => {
    const request = vi.fn(async (input: { action: string }) => {
      if (input.action === 'listSkills') return { skills: ['office-reader'] }
      throw new Error('remove denied')
    })
    overlay({ request } as unknown as SkillHubBridge)
    await waitFor(() => { expect(screen.getByText('office-reader')).toBeTruthy() })
    fireEvent.click(screen.getByRole('button', { name: en.remove }))
    await waitFor(() => { expect(screen.getByRole('alert').textContent).toContain('remove denied') })
  })

  it('searches, filters, sorts, pages, downloads, scrolls, and closes discovery', async () => {
    let catalogCalls = 0
    const request = vi.fn(async (input: { action: string; page?: number }) => {
      if (input.action === 'listSkills') return { skills: [] }
      if (input.action === 'downloadSkill') return { path: '/skills/office-reader' }
      if (input.action === 'skillHubSkills') {
        catalogCalls += 1
        return {
          items: input.page === 1 ? [
            { slug: 'office-reader', name: 'Office Reader', descriptionZh: '读取文档', category: 'documents', iconUrl: 'https://img.test/office.png', downloads: 10, stars: 2, publisher: { name: 'DeepSeek' }, requires_api_key: true },
            { slug: 'local-search', name: 'Local Search', description: 'Search files', downloads: 3, stars: 1, source: 'community' },
          ] : [
            { slug: 'office-reader', name: 'Duplicate', downloads: 0, stars: 0 },
            { slug: `page-${input.page}`, name: 'Next page', downloads: 0, stars: 0 },
          ],
          total: 100,
        }
      }
      throw new Error('unexpected request')
    })
    const test = overlay({ request } as unknown as SkillHubBridge)
    fireEvent.click(screen.getByRole('button', { name: en.discovery }))
    await waitFor(() => { expect(screen.getByText('Office Reader')).toBeTruthy() })
    expect(screen.getByText('读取文档')).toBeTruthy()
    expect(screen.getByText('Search files')).toBeTruthy()
    expect(screen.getByText('DeepSeek')).toBeTruthy()
    expect(screen.getByText('community')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: en.apiKeyAll }))
    fireEvent.click(screen.getByRole('menuitemradio', { name: en.apiKeyRequired }))
    expect(screen.queryByText('Local Search')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: en.apiKeyRequired }))
    fireEvent.click(screen.getByRole('menuitemradio', { name: en.apiKeyNone }))
    expect(screen.queryByText('Office Reader')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: en.apiKeyNone }))
    fireEvent.click(screen.getByRole('menuitemradio', { name: en.apiKeyAll }))

    fireEvent.click(screen.getByRole('button', { name: en.allSources }))
    fireEvent.click(screen.getByRole('menuitemradio', { name: en.officialSource }))
    await waitFor(() => { expect(catalogCalls).toBeGreaterThan(1) })
    fireEvent.click(screen.getByRole('button', { name: en.officialSource }))
    fireEvent.click(screen.getByRole('menuitemradio', { name: en.communitySource }))
    await waitFor(() => { expect(screen.getByRole('button', { name: en.communitySource })).toBeTruthy() })
    fireEvent.click(screen.getByRole('button', { name: en.communitySource }))
    fireEvent.click(screen.getByRole('button', { name: en.communitySource }))
    fireEvent.click(screen.getByRole('button', { name: en.allCategories }))
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'documents' }))
    fireEvent.click(screen.getByRole('button', { name: en.sortTrending }))
    fireEvent.click(screen.getByRole('button', { name: en.sortDownloads }))
    fireEvent.click(screen.getByRole('button', { name: en.sortNewest }))
    fireEvent.click(screen.getByRole('button', { name: en.sortScore }))

    const search = screen.getByRole('searchbox', { name: en.searchSkills })
    fireEvent.change(search, { target: { value: ' office ' } })
    fireEvent.submit(search.closest('form')!)
    await waitFor(() => { expect(request).toHaveBeenCalledWith(expect.objectContaining({ action: 'skillHubSkills', query: 'office' })) })

    fireEvent.click(screen.getAllByRole('button', { name: en.download })[0]!)
    await waitFor(() => { expect(request).toHaveBeenCalledWith({ action: 'downloadSkill', slug: 'office-reader' }) })
    fireEvent.click(screen.getByRole('button', { name: en.loadMore }))
    await waitFor(() => { expect(screen.getByText('Next page')).toBeTruthy() })
    expect(screen.getAllByText('Office Reader')).toHaveLength(1)

    const viewport = test.view.container.querySelector('[class*="viewport"]') as HTMLDivElement
    Object.defineProperties(viewport, {
      scrollHeight: { value: 400 },
      scrollTop: { value: 300, writable: true },
      clientHeight: { value: 100 },
    })
    fireEvent.scroll(viewport)
    await waitFor(() => { expect(request).toHaveBeenCalledWith(expect.objectContaining({ action: 'skillHubSkills', page: 3 })) })
    viewport.scrollTop = 0
    fireEvent.scroll(viewport)
    fireEvent.click(screen.getByRole('button', { name: en.previous }))
    await waitFor(() => { expect(screen.getByText('Page 2')).toBeTruthy() })
    fireEvent.click(screen.getByRole('button', { name: en.next }))
    await waitFor(() => { expect(screen.getByText('Page 3')).toBeTruthy() })
    fireEvent.keyDown(window, { key: 'Enter' })
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(test.controller.getSnapshot()).toBe(false)
  })

  it('reports discovery and download failures', async () => {
    const request = vi.fn(async (input: { action: string }) => {
      if (input.action === 'listSkills') return { skills: [] }
      if (input.action === 'skillHubSkills') return { items: [{ slug: 'broken', name: 'Broken', downloads: 0, stars: 0 }], total: 1 }
      throw 'download denied'
    })
    const test = overlay({ request } as unknown as SkillHubBridge)
    fireEvent.click(screen.getByRole('button', { name: en.discovery }))
    await waitFor(() => { expect(screen.getByText('Broken')).toBeTruthy() })
    fireEvent.click(screen.getByRole('button', { name: en.download }))
    await waitFor(() => { expect(screen.getByRole('alert').textContent).toContain('download denied') })
    test.view.unmount()

    const failing = overlay({ request: vi.fn(async (input: { action: string }) => {
      if (input.action === 'listSkills') return { skills: [] }
      throw new Error('catalog offline')
    }) } as unknown as SkillHubBridge)
    fireEvent.click(screen.getByRole('button', { name: en.discovery }))
    await waitFor(() => { expect(screen.getByRole('alert').textContent).toContain('catalog offline') })
    failing.view.unmount()
  })

  it('supersedes stale discovery failures and deduplicates overlapping pagination', async () => {
    const first = deferred<{ items: readonly Record<string, unknown>[]; total: number }>()
    const page = deferred<{ items: readonly Record<string, unknown>[]; total: number }>()
    let catalogCalls = 0
    const request = vi.fn((input: { action: string; page?: number; query?: string }) => {
      if (input.action === 'listSkills') return Promise.resolve({ skills: [] })
      if (input.action !== 'skillHubSkills') return Promise.reject(new Error('unexpected request'))
      catalogCalls += 1
      if (catalogCalls === 1) return first.promise
      if (input.page === 2) return page.promise
      return Promise.resolve({ items: [{ slug: 'current', name: 'Current', downloads: 0, stars: 0 }], total: 100 })
    })
    const test = overlay({ request } as unknown as SkillHubBridge)
    fireEvent.click(screen.getByRole('button', { name: en.discovery }))
    const search = screen.getByRole('searchbox', { name: en.searchSkills })
    fireEvent.change(search, { target: { value: 'current' } })
    fireEvent.submit(search.closest('form')!)
    await waitFor(() => { expect(screen.getByText('Current')).toBeTruthy() })
    first.reject(new Error('stale failure'))
    await Promise.resolve()
    expect(screen.queryByText(/stale failure/)).toBeNull()

    const loadMore = screen.getByRole('button', { name: en.loadMore })
    fireEvent.click(loadMore)
    fireEvent.click(loadMore)
    expect(request.mock.calls.filter(([input]) => (input as { page?: number }).page === 2)).toHaveLength(1)
    expect(screen.getByText(en.loadingMore)).toBeTruthy()
    page.resolve({ items: [{ slug: 'next', name: 'Next', downloads: 0, stars: 0 }], total: 100 })
    await waitFor(() => { expect(screen.getByText('Next')).toBeTruthy() })
    test.view.unmount()
  })
})
