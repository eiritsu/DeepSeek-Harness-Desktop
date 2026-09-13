import { describe, expect, it, vi } from 'vitest'
import type { LarkManagementStatus } from '@deepseek-ai/dsh-lark'
import { LarkManagementController } from '../src/client/controller.ts'

const STATUS = {
  appId: 'cli_test',
  brand: 'feishu',
  credentialMode: 'self-built',
  secretConfigured: true,
  secretWritable: true,
  userAuthorizationPending: false,
  cliAvailable: true,
  bot: { status: 'ready', available: true, verified: true },
  user: { status: 'ready', available: true, verified: true },
  userAuthorizationMissingScopes: [],
  conversation: { status: 'ready' },
  capabilities: [],
  permissionTemplate: '{"scopes":[]}',
} satisfies LarkManagementStatus

const ok = <T>(value: T) => ({ ok: true as const, value })
const denied = (message: string) => ({ ok: false as const, error: { message } })

describe('Lark managed connection', () => {
  it('continues from application registration into current-user OAuth', async () => {
    const calls: string[] = []
    const remote = {
      completeManagedRegistration: vi.fn(async () => {
        calls.push('application')
        return { ok: true, value: undefined }
      }),
      beginUserAuth: vi.fn(async () => {
        calls.push('user')
        return {
          ok: true,
          value: {
            verificationUrl: 'https://accounts.feishu.cn/oauth/v1/device/verify',
          },
        }
      }),
      status: vi.fn(async () => ({
        ok: true,
        value: { userAuthorizationPending: true } as LarkManagementStatus,
      })),
    }
    const openUrl = vi.fn()
    const controller = new LarkManagementController(
      remote,
      openUrl,
    )
    controller.store.update((draft) => { draft.registrationPending = true })

    await controller.completeManagedRegistration()

    expect(calls).toEqual(['application', 'user'])
    expect(openUrl).toHaveBeenCalledWith('https://accounts.feishu.cn/oauth/v1/device/verify')
    expect(controller.store.getSnapshot()).toMatchObject({
      registrationPending: false,
      authPending: true,
      outcome: 'saved',
    })
  })

  it('restores unfinished current-user authorization from Host status', async () => {
    const remote = {
      status: vi.fn(async () => ({
        ok: true,
        value: { userAuthorizationPending: true } as LarkManagementStatus,
      })),
    }
    const controller = new LarkManagementController(
      remote,
    )

    await controller.refresh()

    expect(controller.store.getSnapshot()).toMatchObject({
      status: 'ready',
      authPending: true,
    })
  })

  it('clears the app-registration step after Host auto-saves credentials', async () => {
    const remote = {
      status: vi.fn(async () => ({
        ok: true,
        value: { credentialMode: 'managed', userAuthorizationPending: false } as LarkManagementStatus,
      })),
    }
    const controller = new LarkManagementController(
      remote,
    )
    controller.store.update((draft) => { draft.registrationPending = true })

    await controller.refresh()

    expect(controller.store.getSnapshot()).toMatchObject({
      registrationPending: false,
      status: 'ready',
    })
  })

  it('surfaces a failed confirmation instead of appearing inert', async () => {
    const remote = {
      completeManagedRegistration: vi.fn(async () => ({
        ok: false,
        error: { message: 'No managed Lark application registration is pending' },
      })),
    }
    const controller = new LarkManagementController(
      remote,
    )
    controller.store.update((draft) => { draft.registrationPending = true })

    await controller.completeManagedRegistration()

    expect(controller.store.getSnapshot()).toMatchObject({
      outcome: 'error',
      errorMessage: 'No managed Lark application registration is pending',
    })
  })

  it('completes authorization through the Host-owned pending code', async () => {
    const remote = {
      completeUserAuth: vi.fn(async () => ({ ok: true, value: undefined })),
      status: vi.fn(async () => ({ ok: true, value: STATUS })),
    }
    const controller = new LarkManagementController(
      remote,
    )
    controller.store.update((draft) => { draft.authPending = true })

    await controller.completeUserAuth()

    expect(remote.completeUserAuth).toHaveBeenCalledWith()
    expect(controller.store.getSnapshot()).toMatchObject({
      authPending: false,
      outcome: 'authorized',
    })
  })

  it('ignores overlapping refreshes and reports Host and transport failures', async () => {
    const remote = { status: vi.fn(async () => ok(STATUS)) }
    const controller = new LarkManagementController(remote as never)
    controller.store.update((draft) => { draft.busy = 'save' })
    await controller.refresh()
    expect(remote.status).not.toHaveBeenCalled()

    controller.store.update((draft) => { delete draft.busy })
    remote.status.mockResolvedValueOnce(denied('status denied') as never)
    await controller.refresh()
    expect(controller.store.getSnapshot()).toMatchObject({ status: 'error', outcome: 'error', errorMessage: 'status denied' })

    remote.status.mockRejectedValueOnce('offline')
    await controller.refresh()
    expect(controller.store.getSnapshot().errorMessage).toBe('offline')
  })

  it('saves applications with optional replacement secrets and refreshes status', async () => {
    const remote = {
      saveApplication: vi.fn(async () => ok(undefined)),
      status: vi.fn(async () => ok(STATUS)),
    }
    const controller = new LarkManagementController(remote as never)
    controller.store.update((draft) => { draft.registrationPending = true })
    await controller.save('cli_test', 'lark', '')
    await controller.save('cli_next', 'feishu', 'secret')
    expect(remote.saveApplication).toHaveBeenNthCalledWith(1, { appId: 'cli_test', brand: 'lark' })
    expect(remote.saveApplication).toHaveBeenNthCalledWith(2, { appId: 'cli_next', brand: 'feishu', appSecret: 'secret' })
    expect(controller.store.getSnapshot()).toMatchObject({ status: 'ready', outcome: 'saved', registrationPending: true })
  })

  it.each([
    ['saveApplication', 'save', ['cli_test', 'feishu', 'secret']],
    ['clearSecret', 'clearSecret', []],
    ['beginManagedRegistration', 'beginManagedRegistration', ['feishu']],
    ['beginUserAuth', 'beginUserAuth', []],
    ['completeUserAuth', 'completeUserAuth', []],
  ] as const)('reports rejected %s operations', async (remoteMethod, controllerMethod, args) => {
    const remote = { [remoteMethod]: vi.fn(async () => denied(`${remoteMethod} denied`)) }
    const controller = new LarkManagementController(remote as never)
    await Reflect.apply(controller[controllerMethod], controller, args)
    expect(controller.store.getSnapshot()).toMatchObject({ outcome: 'error', errorMessage: `${remoteMethod} denied` })
    expect(controller.store.getSnapshot().busy).toBeUndefined()
  })

  it('clears a secret and refreshes the resulting state', async () => {
    const remote = {
      clearSecret: vi.fn(async () => ok(undefined)),
      status: vi.fn(async () => ok({ ...STATUS, secretConfigured: false })),
    }
    const controller = new LarkManagementController(remote as never)
    await controller.clearSecret()
    expect(controller.store.getSnapshot().value?.secretConfigured).toBe(false)
  })

  it('starts managed registration and current-user authorization', async () => {
    const remote = {
      beginManagedRegistration: vi.fn(async () => ok({ verificationUrl: 'https://lark.test/register' })),
      beginUserAuth: vi.fn(async () => ok({ verificationUrl: 'https://lark.test/authorize' })),
    }
    const openUrl = vi.fn()
    const controller = new LarkManagementController(remote as never, openUrl)
    await controller.beginManagedRegistration('lark')
    await controller.beginUserAuth()
    expect(openUrl.mock.calls).toEqual([['https://lark.test/register'], ['https://lark.test/authorize']])
    expect(controller.store.getSnapshot()).toMatchObject({ registrationPending: true, authPending: true })
  })

  it('reports each managed-registration continuation failure', async () => {
    const rejectedCompletion = new LarkManagementController({
      completeManagedRegistration: vi.fn(async () => denied('registration denied')),
    } as never)
    await rejectedCompletion.completeManagedRegistration()
    expect(rejectedCompletion.store.getSnapshot().errorMessage).toBe('registration denied')

    const rejectedAuth = new LarkManagementController({
      completeManagedRegistration: vi.fn(async () => ok(undefined)),
      beginUserAuth: vi.fn(async () => denied('auth denied')),
    } as never)
    await rejectedAuth.completeManagedRegistration()
    expect(rejectedAuth.store.getSnapshot().errorMessage).toBe('auth denied')

    const rejectedRefresh = new LarkManagementController({
      completeManagedRegistration: vi.fn(async () => ok(undefined)),
      beginUserAuth: vi.fn(async () => ok({ verificationUrl: 'https://lark.test/auth' })),
      status: vi.fn(async () => denied('refresh denied')),
    } as never, vi.fn())
    await rejectedRefresh.completeManagedRegistration()
    expect(rejectedRefresh.store.getSnapshot().errorMessage).toBe('refresh denied')
  })

  it('copies the permission template and reports clipboard errors', async () => {
    const writeText = vi.fn(async () => {})
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    const controller = new LarkManagementController({} as never)
    await controller.copyPermissions()
    expect(writeText).not.toHaveBeenCalled()

    controller.store.update((draft) => { draft.value = STATUS })
    await controller.copyPermissions()
    expect(writeText).toHaveBeenCalledWith(STATUS.permissionTemplate)
    expect(controller.store.getSnapshot().outcome).toBe('copied')

    writeText.mockRejectedValueOnce('clipboard denied')
    await controller.copyPermissions()
    expect(controller.store.getSnapshot()).toMatchObject({ outcome: 'error', errorMessage: 'clipboard denied' })
    vi.unstubAllGlobals()
  })

  it('reports a rejected refresh after authorization completion', async () => {
    const controller = new LarkManagementController({
      completeUserAuth: vi.fn(async () => ok(undefined)),
      status: vi.fn(async () => denied('refresh denied')),
    } as never)
    await controller.completeUserAuth()
    expect(controller.store.getSnapshot()).toMatchObject({ outcome: 'error', errorMessage: 'refresh denied' })
  })
})
