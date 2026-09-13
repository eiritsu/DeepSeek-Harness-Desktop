// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ComponentProps } from 'react'
import { DeepseekFilesSection } from '../src/client/DeepseekFilesSection.tsx'
import type { DeepseekFilesSectionProps } from '../src/client/DeepseekFilesSection.tsx'
import type { DeepseekFilesSettingsState } from '../src/client/controller.ts'
import { en, type DeepseekFilesLocaleKey } from '../src/client/locales.ts'
import { DesktopDataSection } from '../src/client/DesktopDataSection.tsx'

afterEach(() => {
  cleanup()
  Reflect.deleteProperty(window, 'dshDesktop')
  Reflect.deleteProperty(window, 'dshDesktopPluginBridge')
})

const t = ((key: DeepseekFilesLocaleKey): string => en[key]) as DeepseekFilesSectionProps['t']
const desktopProps = { t, close: () => {} } as unknown as ComponentProps<typeof DesktopDataSection>

const READY: DeepseekFilesSettingsState = {
  status: 'ready',
  writable: true,
  value: {
    ocr: { endpoint: 'https://ocr.test/v1/chat/completions', model: 'ocr-old' },
  },
  credentials: {
    ocr: { configured: true, writable: true },
    audioTranscription: { configured: false, writable: true },
    videoUnderstanding: { configured: false, writable: true },
  },
}

function props(state: DeepseekFilesSettingsState) {
  const controller = {
    loadCredentials: vi.fn(() => Promise.resolve()),
    save: vi.fn(() => Promise.resolve()),
    removeKey: vi.fn(() => Promise.resolve()),
  }
  return {
    value: {
      t,
      controller,
      useDeepseekFiles: ((selector: (value: DeepseekFilesSettingsState) => unknown) => selector(state)),
    } as unknown as DeepseekFilesSectionProps,
    controller,
  }
}

describe('DeepseekFilesSection', () => {
  it('edits the three recognition providers without exposing a stored key', async () => {
    const fixture = props(READY)
    render(<DeepseekFilesSection {...fixture.value} />)

    expect(screen.getByRole('heading', { name: 'Deepseek-Files' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: en.ocrTitle })).toBeTruthy()
    expect(screen.getByRole('heading', { name: en.audioTitle })).toBeTruthy()
    expect(screen.getByRole('heading', { name: en.videoTitle })).toBeTruthy()
    expect(screen.getByText(en.keyConfigured)).toBeTruthy()
    expect(screen.getAllByPlaceholderText(en.apiKeyPlaceholder)).toHaveLength(3)

    const models = screen.getAllByLabelText(en.model)
    const endpoints = screen.getAllByLabelText(en.endpoint)
    const keys = screen.getAllByLabelText(en.apiKey)
    fireEvent.change(models[0]!, { target: { value: 'ocr-next' } })
    fireEvent.change(endpoints[0]!, { target: { value: 'https://next.test/v1/chat/completions' } })
    fireEvent.change(keys[0]!, { target: { value: 'secret-next' } })
    fireEvent.click(screen.getAllByRole('button', { name: en.save })[0]!)

    await waitFor(() => {
      expect(fixture.controller.save).toHaveBeenCalledWith(
        'ocr',
        'https://next.test/v1/chat/completions',
        'ocr-next',
        'secret-next',
      )
    })
    fireEvent.click(screen.getByRole('button', { name: en.removeKey }))
    expect(fixture.controller.removeKey).toHaveBeenCalledWith('ocr')
  })

  it('renders loading, unavailable, and read-only states', () => {
    const loading = props({ ...READY, status: 'loading' })
    const view = render(<DeepseekFilesSection {...loading.value} />)
    expect(screen.getByText(en.loading)).toBeTruthy()

    view.rerender(<DeepseekFilesSection {...props({ ...READY, status: 'unavailable' }).value} />)
    expect(screen.getByText(en.unavailable)).toBeTruthy()

    view.rerender(<DeepseekFilesSection {...props({
      ...READY,
      writable: false,
      busy: 'ocr',
      outcome: 'saved',
      credentials: { ...READY.credentials, audioTranscription: { configured: false, writable: false } },
    }).value} />)
    expect(screen.getByText(en.readOnly)).toBeTruthy()
    expect(screen.getByText(en.keyReadOnly)).toBeTruthy()
    expect(screen.getByRole('button', { name: en.saving }).hasAttribute('disabled')).toBe(true)
    expect(screen.getByRole('status').textContent).toBe(en.saved)

    view.rerender(<DeepseekFilesSection {...props({ ...READY, outcome: 'error' }).value} />)
    expect(screen.getByRole('alert').textContent).toBe(en.saveFailed)
  })
})

describe('DesktopDataSection', () => {
  it('labels Electron Session database backups as unredacted', async () => {
    const bridge = {
      exportBackup: vi.fn(() => Promise.resolve({})),
      importBackup: vi.fn(() => Promise.resolve({ imported: true })),
      reset: vi.fn(() => Promise.resolve({ reset: true })),
    }
    Object.defineProperty(window, 'dshDesktop', { configurable: true, value: { data: bridge } })
    render(<DesktopDataSection {...desktopProps} />)

    expect(screen.getByRole('heading', { name: en.sessionBackupTitle })).toBeTruthy()
    expect(screen.getByText(en.sessionBackupIntro)).toBeTruthy()
    expect(screen.queryByRole('heading', { name: en.configBackupTitle })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: en.exportData }))
    await waitFor(() => { expect(bridge.exportBackup).toHaveBeenCalledOnce() })
    fireEvent.click(screen.getByRole('button', { name: en.importData }))
    await waitFor(() => { expect(bridge.importBackup).toHaveBeenCalledOnce() })
    fireEvent.click(screen.getByRole('button', { name: en.resetSessions }))
    await waitFor(() => { expect(bridge.reset).toHaveBeenCalledOnce() })
    expect(screen.getByRole('status').textContent).toBe(en.dataDone)
  })

  it('keeps Swift configuration, Session, and full-reset operations separate', async () => {
    const request = vi.fn(() => Promise.resolve({}))
    Object.defineProperty(window, 'dshDesktopPluginBridge', { configurable: true, value: { request } })
    render(<DesktopDataSection {...desktopProps} />)

    expect(screen.getByRole('heading', { name: en.configBackupTitle })).toBeTruthy()
    expect(screen.getByRole('heading', { name: en.sessionBackupTitle })).toBeTruthy()
    expect(screen.getByRole('heading', { name: en.resetAllTitle })).toBeTruthy()
    fireEvent.click(screen.getAllByRole('button', { name: en.exportData })[1]!)
    await waitFor(() => {
      expect(request).toHaveBeenCalledWith({ action: 'exportSessionDatabase' })
    })
    const actions = [
      [screen.getAllByRole('button', { name: en.exportData })[0]!, 'exportConfig'],
      [screen.getAllByRole('button', { name: en.importData })[0]!, 'importConfig'],
      [screen.getAllByRole('button', { name: en.importData })[1]!, 'importSessionDatabase'],
      [screen.getByRole('button', { name: en.resetSessions }), 'resetSessionDatabase'],
      [screen.getByRole('button', { name: en.resetData }), 'resetData'],
    ] as const
    for (const [button, action] of actions) {
      fireEvent.click(button)
      await waitFor(() => { expect(request).toHaveBeenCalledWith({ action }) })
    }
  })

  it('reports unavailable and failed native operations', async () => {
    const view = render(<DesktopDataSection {...desktopProps} />)
    expect(screen.getByText(en.dataUnavailable)).toBeTruthy()

    const request = vi.fn(() => Promise.reject(new Error('cancelled')))
    Object.defineProperty(window, 'dshDesktopPluginBridge', { configurable: true, value: { request } })
    view.rerender(<DesktopDataSection {...desktopProps} />)
    fireEvent.click(screen.getAllByRole('button', { name: en.exportData })[0]!)
    expect(screen.getByRole('status').textContent).toBe(en.dataWorking)
    await waitFor(() => { expect(screen.getByRole('alert').textContent).toBe(en.dataFailed) })
  })

  it('reports a bridge that disappears while the settings page is open', async () => {
    Object.defineProperty(window, 'dshDesktopPluginBridge', {
      configurable: true,
      value: { request: vi.fn(() => Promise.resolve({})) },
    })
    render(<DesktopDataSection {...desktopProps} />)
    Reflect.deleteProperty(window, 'dshDesktopPluginBridge')
    fireEvent.click(screen.getAllByRole('button', { name: en.exportData })[0]!)
    await waitFor(() => { expect(screen.getByText(en.dataUnavailable)).toBeTruthy() })
  })
})
