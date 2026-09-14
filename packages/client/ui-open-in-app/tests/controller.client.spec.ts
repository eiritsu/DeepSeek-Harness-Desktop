/** Controller wire behavior: host-base resolution, availability filtering, and launch errors. */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { OpenInAppController } from '../src/client/controller.ts'

afterEach(() => {
  vi.unstubAllGlobals()
})

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status })
}

describe('OpenInAppController availability', () => {
  it('starts without a platform-specific choice', () => {
    const controller = new OpenInAppController(async () => jsonResponse({ apps: [] }))
    expect(controller.choice.getSnapshot()).toBe('')
  })

  it('shares one availability read across concurrent loads', async () => {
    const fetcher = vi.fn(async () => jsonResponse({ apps: ['finder'], requestTimeoutMs: 1000 }))
    const controller = new OpenInAppController(fetcher)
    await Promise.all([controller.load(), controller.load()])
    await controller.load()
    expect(fetcher).toHaveBeenCalledOnce()
    expect(controller.apps.getSnapshot()).toEqual(['finder'])
  })

  it('publishes an empty list for a non-OK availability answer and for a non-array payload', async () => {
    const failing = new OpenInAppController(async () => jsonResponse({}, 500))
    await failing.load()
    expect(failing.apps.getSnapshot()).toEqual([])

    const malformed = new OpenInAppController(async () => jsonResponse({ apps: 'nope' }))
    await malformed.load()
    expect(malformed.apps.getSnapshot()).toEqual([])
  })

  it('resolves routes against the page origin when the page has one', async () => {
    vi.stubGlobal('location', { origin: 'http://dsh.example:8080' })
    const fetcher = vi.fn(async (input: string | URL) => { void input; return jsonResponse({ apps: [] }) })
    const controller = new OpenInAppController(fetcher)
    await controller.load()
    expect(String(fetcher.mock.calls[0]?.[0])).toBe('http://dsh.example:8080/open-in-app/apps')
  })

  it('falls back to the internal host base under a null origin', async () => {
    vi.stubGlobal('location', { origin: 'null' })
    const fetcher = vi.fn(async (input: string | URL) => { void input; return jsonResponse({ apps: [] }) })
    const controller = new OpenInAppController(fetcher)
    await controller.load()
    expect(String(fetcher.mock.calls[0]?.[0])).toBe('http://dsh.internal/open-in-app/apps')
  })
})

describe('OpenInAppController launching', () => {
  it('restores the chosen app from the open-in-app storage key', () => {
    const values = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value) },
    })
    const controller = new OpenInAppController(async () => jsonResponse({ apps: [] }))
    controller.choose('cursor')
    expect(controller.choice.getSnapshot()).toBe('cursor')
    expect(values.get('dsh.open-in-app.choice')).toBe('"cursor"')
    const reloaded = new OpenInAppController(async () => jsonResponse({ apps: [] }))
    expect(reloaded.choice.getSnapshot()).toBe('cursor')
  })

  it('posts the launch body and surfaces HTTP failures', async () => {
    const fetcher = vi.fn(async (input: string | URL, init?: RequestInit) => {
      void init
      return String(input).includes('/apps')
        ? jsonResponse({ apps: ['cursor'], requestTimeoutMs: 1000 })
        : jsonResponse({ ok: true })
    })
    const controller = new OpenInAppController(fetcher)
    await controller.load()
    await controller.launch('cursor', '/w/dir')
    expect(fetcher.mock.calls[1]?.[1]).toMatchObject({
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ app: 'cursor', path: '/w/dir' }),
    })

    const failing = new OpenInAppController(async input => String(input).includes('/apps')
      ? jsonResponse({ apps: ['cursor'], requestTimeoutMs: 1000 })
      : jsonResponse({}, 404))
    await failing.load()
    await expect(failing.launch('cursor', '/w/dir')).rejects.toThrow('open failed: HTTP 404')
  })

  it('aborts a stuck launch at the host-supplied deadline and permits a retry', async () => {
    let attempts = 0
    const fetcher = vi.fn(async (input: string | URL, init?: RequestInit) => {
      if (String(input).includes('/apps')) return jsonResponse({ apps: ['finder'], requestTimeoutMs: 5 })
      attempts += 1
      if (attempts > 1) return jsonResponse({ ok: true })
      return await new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(init.signal?.reason instanceof Error ? init.signal.reason : new Error('aborted'))
        }, { once: true })
      })
    })
    const controller = new OpenInAppController(fetcher)
    await controller.load()
    await expect(controller.launch('finder', '/w')).rejects.toThrow('timed out')
    await expect(controller.launch('finder', '/w')).resolves.toBeUndefined()
  })
})
