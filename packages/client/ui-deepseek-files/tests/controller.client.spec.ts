import { describe, expect, it, vi } from 'vitest'
import type { SettingsScope, SettingsScopeSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import { CREDENTIAL_REFS, DeepseekFilesSettingsController } from '../src/client/controller.ts'
import type { DeepseekFilesSettings } from '../src/client/controller.ts'

function fixture(options: {
  snapshot?: Partial<SettingsScopeSnapshot<DeepseekFilesSettings>>
  describe?: () => Promise<unknown>
  set?: (field: string, value: unknown) => Promise<void>
  unset?: () => Promise<unknown>
} = {}) {
  let snapshot: SettingsScopeSnapshot<DeepseekFilesSettings> = {
    status: 'ready',
    value: {},
    base: undefined,
    user: undefined,
    revision: 0,
    writable: true,
    mode: 'host',
    ...options.snapshot,
  }
  const listeners = new Set<() => void>()
  const set = vi.fn(options.set ?? (async (field: string, value: unknown) => {
    snapshot = { ...snapshot, value: { ...snapshot.value, [field]: value } }
    for (const listener of listeners) listener()
  }))
  const scope: SettingsScope<DeepseekFilesSettings> = {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    mutate: vi.fn(() => Promise.resolve()),
    set,
    unset: vi.fn(() => Promise.resolve()),
  }
  const describe = vi.fn(options.describe ?? (async () => ({ ok: true as const, value: {
    [CREDENTIAL_REFS.ocr]: { configured: true, writable: true },
  } })))
  const credentials = {
    describe,
    set: vi.fn(() => Promise.resolve({ ok: true as const, value: {} })),
    unset: vi.fn(options.unset ?? (() => Promise.resolve({ ok: true as const, value: {} }))),
  }
  const controller = new DeepseekFilesSettingsController(scope, { credentials } as never)
  return { controller, credentials, set, listeners }
}

describe('DeepseekFilesSettingsController', () => {
  it('writes settings and credentials through their separate owners', async () => {
    const test = fixture()
    await test.controller.save('ocr', ' https://ocr.test/v1 ', ' model-1 ', 'key-1')

    expect(test.set).toHaveBeenCalledWith('ocr', {
      endpoint: 'https://ocr.test/v1',
      model: 'model-1',
      apiKeyEnv: CREDENTIAL_REFS.ocr,
    })
    expect(test.credentials.set).toHaveBeenCalledWith(CREDENTIAL_REFS.ocr, 'key-1')
    expect(test.controller.store.getSnapshot()).toMatchObject({ outcome: 'saved' })
    expect(test.controller.store.getSnapshot()).not.toHaveProperty('busy')

    await test.controller.removeKey('ocr')
    expect(test.credentials.unset).toHaveBeenCalledWith(CREDENTIAL_REFS.ocr)
    test.controller.dispose()
    expect(test.listeners.size).toBe(0)
  })

  it('ignores unrelated credential invalidations', () => {
    const test = fixture()
    test.controller.refreshCredential('UNRELATED_API_KEY')
    expect(test.credentials.describe).not.toHaveBeenCalled()
    test.controller.refreshCredential(CREDENTIAL_REFS.videoUnderstanding)
    expect(test.credentials.describe).toHaveBeenCalledOnce()
  })

  it('maps unavailable values and credential metadata defaults', async () => {
    const test = fixture({
      snapshot: { status: 'unavailable', value: undefined, writable: false },
      describe: async () => ({ ok: true, value: {
        [CREDENTIAL_REFS.audioTranscription]: { configured: true, writable: false },
      } }),
    })
    await test.controller.loadCredentials()
    expect(test.controller.store.getSnapshot()).toMatchObject({
      status: 'unavailable',
      writable: false,
      value: {},
      credentials: {
        ocr: { configured: false, writable: true },
        audioTranscription: { configured: true, writable: false },
      },
    })
  })

  it.each([
    ['rejected response', async () => ({ ok: false, error: { message: 'denied' } })],
    ['transport failure', async () => { throw new Error('offline') }],
  ])('reports credential describe %s', async (_name, describe) => {
    const test = fixture({ describe })
    await test.controller.loadCredentials()
    expect(test.controller.store.getSnapshot().outcome).toBe('error')
  })

  it('reports rejected settings and credential writes', async () => {
    const rejectedSettings = fixture({ set: async () => {} })
    await rejectedSettings.controller.save('ocr', 'https://ocr.test', 'ocr', '')
    expect(rejectedSettings.controller.store.getSnapshot().outcome).toBe('error')

    const rejectedCredential = fixture({ describe: async () => ({ ok: true, value: {} }) })
    await rejectedCredential.controller.save('ocr', 'https://ocr.test', 'ocr', 'secret')
    expect(rejectedCredential.controller.store.getSnapshot().outcome).toBe('error')
  })

  it('preserves an existing key on an empty secret and reports removal failures', async () => {
    const test = fixture({ unset: async () => { throw new Error('read-only') } })
    await test.controller.save('audioTranscription', ' https://audio.test ', ' whisper ', '')
    expect(test.credentials.set).not.toHaveBeenCalled()
    expect(test.controller.store.getSnapshot().outcome).toBe('saved')

    await test.controller.removeKey('audioTranscription')
    expect(test.controller.store.getSnapshot().outcome).toBe('error')
  })
})
