// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { LarkManagementStatus } from '@deepseek-ai/dsh-lark'
import { LarkManagementSection } from '../src/client/LarkManagementSection.tsx'
import type { LarkManagementSectionProps } from '../src/client/LarkManagementSection.tsx'
import type { LarkManagementState } from '../src/client/controller.ts'
import { en, type LarkLocaleKey } from '../src/client/locales.ts'

afterEach(() => { cleanup(); vi.useRealTimers() })

const STATUS = {
  appId: 'cli_test', brand: 'feishu', credentialMode: 'self-built', secretConfigured: true,
  secretWritable: true, userAuthorizationPending: false, cliAvailable: true,
  bot: { status: 'ready', available: true, verified: true },
  user: { status: 'ready', available: true, verified: true },
  userAuthorizationMissingScopes: [], conversation: { status: 'ready' },
  capabilities: [{ id: 'calendar', label: 'Calendar', state: 'granted', missingScopes: [] }],
  permissionTemplate: '{}',
} satisfies LarkManagementStatus
const t = ((key: LarkLocaleKey): string => en[key]) as LarkManagementSectionProps['t']

function fixture(state: LarkManagementState) {
  const controller = {
    refresh: vi.fn(async () => {}), save: vi.fn(async () => {}), clearSecret: vi.fn(async () => {}),
    beginManagedRegistration: vi.fn(async () => {}), completeManagedRegistration: vi.fn(async () => {}),
    copyPermissions: vi.fn(async () => {}), beginUserAuth: vi.fn(async () => {}), completeUserAuth: vi.fn(async () => {}),
  }
  const props = {
    t,
    controller,
    useLarkManagement: (select: (value: LarkManagementState) => unknown) => select(state),
  } as unknown as LarkManagementSectionProps
  return { controller, props }
}

describe('LarkManagementSection', () => {
  it('renders initial loading and error states', () => {
    const view = render(<LarkManagementSection {...fixture({ status: 'loading', authPending: false, registrationPending: false }).props} />)
    expect(screen.getByText(en.loading)).toBeTruthy()
    view.rerender(<LarkManagementSection {...fixture({ status: 'error', authPending: false, registrationPending: false }).props} />)
    expect(screen.getByText(en.loadFailed)).toBeTruthy()
  })

  it('edits a self-built application and invokes identity and permission actions', () => {
    const test = fixture({ status: 'ready', value: STATUS, authPending: false, registrationPending: false })
    render(<LarkManagementSection {...test.props} />)
    fireEvent.change(screen.getByLabelText(en.appId), { target: { value: 'cli_next' } })
    fireEvent.change(screen.getByLabelText(en.appSecret), { target: { value: 'secret' } })
    const brands = screen.getAllByLabelText(en.brand)
    fireEvent.change(brands[0]!, { target: { value: 'lark' } })
    fireEvent.change(brands[1]!, { target: { value: 'lark' } })
    fireEvent.click(screen.getByRole('button', { name: en.save }))
    fireEvent.click(screen.getByRole('button', { name: en.clearSecret }))
    fireEvent.click(screen.getByRole('button', { name: en.startRegistration }))
    fireEvent.click(screen.getByRole('button', { name: en.authorize }))
    fireEvent.click(screen.getByRole('button', { name: en.copyPermissions }))
    fireEvent.click(screen.getByRole('button', { name: en.refresh }))
    expect(test.controller.save).toHaveBeenCalledWith('cli_next', 'lark', 'secret')
    expect(test.controller.clearSecret).toHaveBeenCalledOnce()
    expect(test.controller.beginManagedRegistration).toHaveBeenCalledWith('lark')
    expect(test.controller.beginUserAuth).toHaveBeenCalledOnce()
    expect(test.controller.copyPermissions).toHaveBeenCalledOnce()
    expect(test.controller.refresh).toHaveBeenCalledTimes(2)
    expect(screen.getAllByText(en.ready)).toHaveLength(3)
    expect(screen.getByText(en.granted)).toBeTruthy()
  })

  it('renders managed, pending, read-only, missing-scope, and diagnostic states', () => {
    vi.useFakeTimers()
    const value: LarkManagementStatus = {
      ...STATUS,
      credentialMode: 'managed', secretWritable: false,
      bot: { status: 'failed', available: false, verified: false },
      user: { status: 'ready', available: true },
      userAuthorizationMissingScopes: ['calendar:calendar:readonly'],
      conversation: { status: 'error', diagnostic: 'socket closed' },
      diagnostic: 'CLI unavailable',
    }
    const test = fixture({ status: 'ready', value, authPending: true, registrationPending: true, outcome: 'error', errorMessage: 'denied' })
    const view = render(<LarkManagementSection {...test.props} />)
    expect(screen.getByText(en.managedConnected)).toBeTruthy()
    expect(screen.getByText(en.secretReadOnly)).toBeTruthy()
    expect(screen.getByText(en.verifyFailed)).toBeTruthy()
    expect(screen.getByText(en.reauthorizationRequired)).toBeTruthy()
    expect(screen.getByText(en.conversationError)).toBeTruthy()
    expect(screen.getByText('socket closed')).toBeTruthy()
    expect(screen.getByText('CLI unavailable')).toBeTruthy()
    expect(screen.getByText('denied')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: en.disconnect }))
    fireEvent.click(screen.getByRole('button', { name: en.completeRegistration }))
    fireEvent.click(screen.getByRole('button', { name: en.completeAuth }))
    vi.advanceTimersByTime(2_000)
    expect(test.controller.clearSecret).toHaveBeenCalledOnce()
    expect(test.controller.completeManagedRegistration).toHaveBeenCalledOnce()
    expect(test.controller.completeUserAuth).toHaveBeenCalledOnce()
    expect(test.controller.refresh).toHaveBeenCalledTimes(2)
    view.unmount()
  })

  it('renders unknown identities before the first usable snapshot', () => {
    render(<LarkManagementSection {...fixture({ status: 'ready', authPending: false, registrationPending: false, outcome: 'error' }).props} />)
    expect(screen.getAllByText(en.unknown)).toHaveLength(3)
    expect(screen.getByText(en.secretMissing)).toBeTruthy()
    expect(screen.getByText(en.userAuthBlocked)).toBeTruthy()
    expect(screen.getByText(en.operationFailed)).toBeTruthy()
  })

  it('offers reauthorization for an available identity with missing scopes', () => {
    const value = { ...STATUS, userAuthorizationMissingScopes: ['calendar:calendar:readonly'] }
    const test = fixture({ status: 'ready', value, authPending: false, registrationPending: false })
    render(<LarkManagementSection {...test.props} />)
    fireEvent.click(screen.getByRole('button', { name: en.reauthorize }))
    expect(test.controller.beginUserAuth).toHaveBeenCalledOnce()
  })

  it.each([
    ['disabled', en.conversationDisabled], ['waiting', en.conversationWaiting],
    ['connecting', en.conversationConnecting], ['ready', en.ready],
  ] as const)('labels a %s conversation', (status, label) => {
    const value = { ...STATUS, secretConfigured: false, user: { status: 'none', available: false }, conversation: { status } }
    render(<LarkManagementSection {...fixture({ status: 'ready', value, authPending: false, registrationPending: false }).props} />)
    expect(screen.getAllByText(label).length).toBeGreaterThan(0)
    expect(screen.getByText(en.userAuthBlocked)).toBeTruthy()
  })

  it.each([
    ['save', en.saving], ['begin-registration', en.startingRegistration],
    ['complete-registration', en.completingRegistration], ['begin-auth', en.authorizing],
    ['complete-auth', en.completingAuth],
  ] as const)('labels the %s busy state', (busy, label) => {
    render(<LarkManagementSection {...fixture({ status: 'ready', value: STATUS, authPending: busy === 'complete-auth', registrationPending: busy === 'complete-registration', busy }).props} />)
    expect(screen.getByText(label)).toBeTruthy()
  })

  it.each([
    ['saved', en.saved], ['copied', en.copied], ['authorized', en.authorized],
  ] as const)('renders the %s outcome', (outcome, label) => {
    render(<LarkManagementSection {...fixture({ status: 'ready', value: STATUS, authPending: false, registrationPending: false, outcome }).props} />)
    expect(screen.getByText(label)).toBeTruthy()
  })
})
