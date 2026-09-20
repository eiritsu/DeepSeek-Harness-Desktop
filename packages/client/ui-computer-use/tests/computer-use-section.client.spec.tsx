// @vitest-environment jsdom
import type { GlobalStandardProps } from '@deepseek-ai/dsh-client-ui-slots'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { WorkspaceSnapshot } from '@deepseek-ai/dsh-api-workspace-controller/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import { ComputerUseSection } from '../src/client/ComputerUseSection.tsx'
import type { ComputerUseSectionProps } from '../src/client/ComputerUseSection.tsx'
import { createComputerUseStore } from '../src/client/settings-store.ts'

// Every fixture carries the resource hook the resources plugin merges into GlobalStandardProps.
const useResource = (() => ({ status: 'none' as const, value: undefined, failure: undefined, reload: () => {} })) as GlobalStandardProps['useResource']
const usePanelInfo: GlobalStandardProps['usePanelInfo'] = selector => selector({ activePanelId: null })

afterEach(cleanup)

const COPY: Record<string, string> = {
  'computerUse.title': 'Computer Use',
  'computerUse.description': 'Let models observe and operate the local desktop',
  'computerUse.toggle': 'Enable computer use',
  'computerUse.status.enabled': 'Enabled',
  'computerUse.status.disabled': 'Disabled',
}

function emptySessions() {
  const store = createSnapshotStore<SessionListState>(
    { ids: [], byId: {}, current: undefined, phase: 'ready', subagentsByParent: {}, jobsBySession: {}, currentAddress: undefined })
  return bindSnapshotSelector(store)
}
function emptyWorkspaces() {
  const store = createSnapshotStore<WorkspaceSnapshot>({
    items: [], archivedSessionIds: [], state: 'idle', phase: 'ready', error: null,
  })
  return bindSnapshotSelector(store)
}

type AttentionSnapshot = Parameters<Parameters<ComputerUseSectionProps['useSessionPendingInteraction']>[0]>[0]
const noAttention: AttentionSnapshot = new Map()
const useSessionPendingInteraction: ComputerUseSectionProps['useSessionPendingInteraction'] = selector => selector(noAttention)

function mount(state: { available: boolean; writable: boolean; enabled: boolean }) {
  // Real store instance — the sanctioned zero-machinery path for tests.
  const store = createComputerUseStore().create()
  store.actions.sync({ enabled: state.enabled }, state.available, state.writable)
  const setEnabled = vi.fn()
  const props: ComputerUseSectionProps = {
    useSessions: emptySessions(),
    useSessionPendingInteraction,
    usePanelInfo, useResource,
    useWorkspaces: emptyWorkspaces(),
    useStore: bindSnapshotSelector(store),
    actions: store.actions,
    t: (key: string) => COPY[key] ?? key,
    setEnabled,
    close: () => {},
  }
  const result = render(<ComputerUseSection {...props} />)
  return { setEnabled, ...result }
}

describe('ComputerUseSection', () => {
  it('renders nothing while the Host does not serve the namespace', () => {
    const b = mount({ available: false, writable: false, enabled: false })
    expect(b.container.textContent).toBe('')
  })

  it('renders the localized page and reflects the durable enabled state', () => {
    mount({ available: true, writable: true, enabled: true })
    expect(screen.getByText('Computer Use')).toBeDefined()
    expect(screen.getByText('Let models observe and operate the local desktop')).toBeDefined()
    expect(screen.getByText('Enabled')).toBeDefined()
    const control = screen.getByRole('switch', { name: 'Enable computer use' })
    expect(control.getAttribute('aria-checked')).toBe('true')
    expect((control as HTMLButtonElement).disabled).toBe(false)
  })

  it('click drives setEnabled; the switch follows the store mirror, not the click echo', () => {
    const b = mount({ available: true, writable: true, enabled: true })
    const control = screen.getByRole('switch', { name: 'Enable computer use' })
    fireEvent.click(control)
    expect(b.setEnabled).toHaveBeenCalledWith(false)
    expect(control.getAttribute('aria-checked')).toBe('true')
  })

  it('reports the disabled status', () => {
    mount({ available: true, writable: true, enabled: false })
    expect(screen.getByText('Disabled')).toBeDefined()
    expect(screen.getByRole('switch', { name: 'Enable computer use' }).getAttribute('aria-checked')).toBe('false')
  })

  it('locks the switch while the document is read-only', () => {
    mount({ available: true, writable: false, enabled: false })
    const control = screen.getByRole('switch', { name: 'Enable computer use' })
    expect(control.getAttribute('aria-checked')).toBe('false')
    expect((control as HTMLButtonElement).disabled).toBe(true)
  })
})
