import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import type { SubprocessHandle } from '@deepseek-ai/dsh-subprocess'
import { afterEach, describe, expect, it, vi } from 'vitest'

const channelMocks = vi.hoisted(() => ({
  create: vi.fn(() => ({ channel: true })),
  register: vi.fn(),
  connect: vi.fn(async () => {}),
  dispose: vi.fn(async () => {}),
  bridgeOptions: [] as Array<Record<string, unknown>>,
}))

vi.mock('@larksuite/channel', async importOriginal => ({
  ...await importOriginal<typeof import('@larksuite/channel')>(),
  createLarkChannel: channelMocks.create,
  registerApp: channelMocks.register,
}))

vi.mock('../src/conversation.ts', () => ({
  LarkConversationBridge: class {
    constructor(_ctx: unknown, _channel: unknown, options: Record<string, unknown>) {
      channelMocks.bridgeOptions.push(options)
    }
    connect = channelMocks.connect
    dispose = channelMocks.dispose
  },
}))

import LarkManagementGateway, {
  LARK_APP_SECRET_REF,
  LARK_PENDING_USER_AUTH_REF,
} from '../src/index.ts'
import { requestedUserScopes } from '../src/permissions.ts'

interface CliReply {
  readonly exitCode?: number | null
  readonly signal?: string | null
  readonly stdout?: string
  readonly stderr?: string
  readonly noStreams?: boolean
  readonly spawnError?: unknown
  readonly done?: Promise<{ exitCode: number | null; signal: string | null }>
}

interface GatewayHarness {
  readonly ctx: Context
  readonly gateway: LarkManagementGateway
  readonly config: Record<string, unknown>
  readonly credentials: Map<string, string>
  readonly spawned: Array<Record<string, unknown>>
  readonly tools: Array<Record<string, unknown>>
  readonly root: string
}

const roots: string[] = []

afterEach(async () => {
  vi.clearAllMocks()
  channelMocks.bridgeOptions.length = 0
  vi.unstubAllEnvs()
  await Promise.all(roots.splice(0).map(async (root) => { await rm(root, { recursive: true, force: true }) }))
})

function stream(text: string): { readFrom(): { text: string } } {
  return { readFrom: () => ({ text }) }
}

async function makeHarness(
  replies: CliReply[] = [],
  base: Record<string, unknown> = {},
  initialCredentials: Record<string, string> = {},
): Promise<GatewayHarness> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-lark-gateway-'))
  roots.push(root)
  const config: Record<string, unknown> = {
    appId: '',
    brand: 'feishu',
    appSecretEnv: String(LARK_APP_SECRET_REF),
    cliTimeoutMs: 30_000,
    maxOutputBytes: 262_144,
    cliConfigDir: join(root, 'cli'),
    credentialMode: 'none',
    registrationTimeoutMs: 600_000,
    conversationEnabled: false,
    conversationUserOpenId: '',
    conversationHandshakeTimeoutMs: 30_000,
    conversationResponseTimeoutMs: 600_000,
    conversationCwd: '',
    conversationTimeZone: 'Asia/Shanghai',
    ...base,
  }
  const credentials = new Map(Object.entries(initialCredentials))
  const spawned: Array<Record<string, unknown>> = []
  const tools: Array<Record<string, unknown>> = []
  const ctx = new Context()
  ctx.provide('settings', {
    register: () => ({
      get: () => ({ ...config }),
      update: async (patch: Record<string, unknown>) => { Object.assign(config, patch) },
    }),
  } as never)
  ctx.provide('credentials', {
    describe: async (ref: string) => ({
      configured: credentials.has(ref),
      writable: true,
    }),
    resolve: async (ref: string) => {
      const value = credentials.get(ref)
      return value === undefined ? undefined : { value, source: 'test' }
    },
    set: async (ref: string, value: string) => { credentials.set(ref, value) },
    unset: async (ref: string) => { credentials.delete(ref) },
  } as never)
  ctx.provide('subprocess', {
    spawn: (request: Record<string, unknown>) => {
      spawned.push(request)
      const reply = replies.shift() ?? {}
      if (reply.spawnError !== undefined) throw reply.spawnError
      return {
        done: reply.done ?? Promise.resolve({ exitCode: reply.exitCode ?? 0, signal: reply.signal ?? null }),
        collected: {
          stdout: reply.noStreams === true ? undefined : stream(reply.stdout ?? ''),
          stderr: reply.noStreams === true ? undefined : stream(reply.stderr ?? ''),
        },
      } as unknown as SubprocessHandle
    },
  } as never)
  ctx.provide('tools', {
    register: (tool: Record<string, unknown>) => {
      tools.push(tool)
      return () => {}
    },
  } as never)
  ctx.provide('agents', { get: () => undefined, list: () => [] } as never)
  ctx.provide('agentDefaultModel', { currentSelection: () => ({ provider: '', model: '' }) } as never)
  ctx.provide('attachments', {} as never)
  ctx.provide('sessionPersistence', {} as never)
  ctx.provide('sessionQuery', {} as never)
  ctx.provide('workspaceRegistry', {} as never)
  const gateway = new LarkManagementGateway(ctx, config)
  await Promise.resolve()
  return { ctx, gateway, config, credentials, spawned, tools, root }
}

describe('LarkManagementGateway', () => {
  it('reports an unconfigured installation without invoking the CLI', async () => {
    const runtime = await makeHarness()
    await expect(runtime.gateway.status()).resolves.toMatchObject({
      appId: '',
      credentialMode: 'none',
      cliAvailable: false,
      secretConfigured: false,
      userAuthorizationPending: false,
      bot: { status: 'missing', available: false },
      user: { status: 'missing', available: false },
      conversation: { status: 'disabled' },
    })
    expect(runtime.spawned).toEqual([])
    await runtime.ctx.fiber.dispose()
  })

  it('projects CLI identities, permissions, diagnostics, and managed mode', async () => {
    const runtime = await makeHarness([
      {
        stdout: JSON.stringify({
          appId: 'cli_app',
          brand: 'lark',
          identities: {
            bot: { status: 'ready', available: true, verified: true },
            user: { status: '', available: 'yes' },
          },
        }),
      },
      { stdout: JSON.stringify({ data: { app: { scopes: [] } } }) },
    ], { appId: 'configured', credentialMode: 'none' })
    await mkdir(String(runtime.config.cliConfigDir), { recursive: true })
    await writeFile(join(String(runtime.config.cliConfigDir), 'config.json'), '{}')
    runtime.credentials.set(String(LARK_APP_SECRET_REF), 'secret')

    const status = await runtime.gateway.status()
    expect(status).toMatchObject({
      appId: 'cli_app',
      brand: 'lark',
      credentialMode: 'managed',
      cliAvailable: true,
      secretConfigured: true,
      secretWritable: false,
      bot: { status: 'ready', available: true, verified: true },
      user: { status: 'unknown', available: false },
    })
    expect(status.capabilities.every(item => item.state === 'missing')).toBe(true)
    expect(status.diagnostic).toBeUndefined()
    await runtime.ctx.fiber.dispose()
  })

  it('reports CLI and permission inspection failures without exposing secrets', async () => {
    const runtime = await makeHarness([
      { exitCode: 1, stderr: 'auth unavailable' },
    ])
    await mkdir(String(runtime.config.cliConfigDir), { recursive: true })
    await writeFile(join(String(runtime.config.cliConfigDir), 'config.json'), '{}')
    const status = await runtime.gateway.status()
    expect(status.cliAvailable).toBe(false)
    expect(status.diagnostic).toContain('auth unavailable')
    expect(status.capabilities.every(item => item.state === 'unknown')).toBe(true)
    await runtime.ctx.fiber.dispose()
  })

  it('validates and saves self-built application credentials', async () => {
    const missing = await makeHarness()
    await expect(missing.gateway.saveApplication({ appId: ' ', brand: 'feishu' }))
      .rejects.toThrow(/must not be empty/)
    await expect(missing.gateway.saveApplication({ appId: 'cli_app', brand: 'feishu' }))
      .rejects.toThrow(/App Secret is required/)
    await missing.ctx.fiber.dispose()

    const failed = await makeHarness([{ exitCode: 1, stderr: 'bad secret' }])
    await expect(failed.gateway.saveApplication({ appId: 'cli_app', brand: 'lark', appSecret: 'bad' }))
      .rejects.toThrow('bad secret')
    await failed.ctx.fiber.dispose()

    const runtime = await makeHarness([], { appId: 'old', conversationUserOpenId: 'ou_old' })
    await runtime.gateway.saveApplication({ appId: ' cli_app ', brand: 'lark', appSecret: 'secret' })
    expect(runtime.config).toMatchObject({
      appId: 'cli_app',
      brand: 'lark',
      credentialMode: 'self-built',
      conversationUserOpenId: '',
    })
    expect(runtime.credentials.get(String(LARK_APP_SECRET_REF))).toBe('secret')
    expect(runtime.spawned[0]?.stdio).toMatchObject({ stdin: { data: 'secret\n' } })
    await runtime.ctx.fiber.dispose()
  })

  it('reuses an existing secret and retains an authorized user for the same app', async () => {
    const runtime = await makeHarness([], { appId: 'cli_app', conversationUserOpenId: 'ou_user' })
    runtime.credentials.set(String(LARK_APP_SECRET_REF), 'existing')
    await runtime.gateway.saveApplication({ appId: 'cli_app', brand: 'feishu' })
    expect(runtime.config.conversationUserOpenId).toBe('ou_user')
    expect(runtime.spawned[0]?.stdio).toMatchObject({ stdin: { data: 'existing\n' } })
    await runtime.ctx.fiber.dispose()
  })

  it('clears CLI state and both credential records', async () => {
    const runtime = await makeHarness([{ exitCode: 1, stderr: '{"subtype": "not_configured"}' }], {
      appId: 'cli_app',
      credentialMode: 'self-built',
      conversationUserOpenId: 'ou_user',
    })
    runtime.credentials.set(String(LARK_APP_SECRET_REF), 'secret')
    runtime.credentials.set(String(LARK_PENDING_USER_AUTH_REF), 'pending')
    await runtime.gateway.clearSecret()
    expect(runtime.config).toMatchObject({ appId: '', credentialMode: 'none', conversationUserOpenId: '' })
    expect(runtime.credentials.size).toBe(0)
    await runtime.ctx.fiber.dispose()

    const failed = await makeHarness([{ exitCode: 1, stdout: 'remove failed' }])
    await expect(failed.gateway.clearSecret()).rejects.toThrow('remove failed')
    await failed.ctx.fiber.dispose()
  })

  it('starts and completes current-user authorization', async () => {
    const runtime = await makeHarness([
      { stdout: JSON.stringify({ verification_url: 'https://verify.test', device_code: 'device' }) },
      { stdout: '{}' },
      { stdout: JSON.stringify({ identities: { user: { available: true, openId: 'ou_user' } } }) },
    ])
    await expect(runtime.gateway.beginUserAuth()).resolves.toEqual({ verificationUrl: 'https://verify.test' })
    expect(runtime.credentials.has(String(LARK_PENDING_USER_AUTH_REF))).toBe(true)
    await runtime.gateway.completeUserAuth()
    expect(runtime.config.conversationUserOpenId).toBe('ou_user')
    expect(runtime.credentials.has(String(LARK_PENDING_USER_AUTH_REF))).toBe(false)
    await runtime.ctx.fiber.dispose()
  })

  it('rejects malformed or absent current-user authorization state', async () => {
    const malformed = await makeHarness([{ stdout: '{}' }])
    await expect(malformed.gateway.beginUserAuth()).rejects.toThrow(/did not return/)
    await expect(malformed.gateway.completeUserAuth()).rejects.toThrow(/No Lark user authorization/)
    malformed.credentials.set(String(LARK_PENDING_USER_AUTH_REF), '{"stale":true}')
    await expect(malformed.gateway.completeUserAuth()).rejects.toThrow(/No Lark user authorization/)
    expect(malformed.credentials.has(String(LARK_PENDING_USER_AUTH_REF))).toBe(false)
    await malformed.ctx.fiber.dispose()

    const failed = await makeHarness([{ exitCode: 1, stderr: 'denied' }])
    failed.credentials.set(String(LARK_PENDING_USER_AUTH_REF), JSON.stringify({
      deviceCode: 'device',
      scopes: (await failed.gateway.status()).userAuthorizationMissingScopes,
    }))
    await expect(failed.gateway.completeUserAuth()).rejects.toThrow('denied')
    await failed.ctx.fiber.dispose()
  })

  it('registers a bounded subprocess-backed tool and write approval gate', async () => {
    const runtime = await makeHarness([{ stdout: 'help\nRisk: read\n' }, { stdout: 'done' }])
    const tool = runtime.tools[0] as {
      execute(args: { arguments: string[] }, exec: { signal: AbortSignal }): Promise<unknown>
      presentCall(args: { arguments: string[] }): unknown
      output: { render(args: unknown, value: { stdout: string; stderr: string; timedOut: boolean }): unknown }
    }
    expect(tool.presentCall({ arguments: ['calendar', '+event-list'] })).toMatchObject({
      title: 'lark-cli calendar +agenda',
    })
    expect(tool.output.render({}, { stdout: 'out', stderr: 'err', timedOut: true }))
      .toEqual([{ type: 'text', text: 'out\nerr\n[timed out]' }])
    expect(tool.output.render({}, { stdout: '', stderr: '', timedOut: false }))
      .toEqual([{ type: 'text', text: '' }])
    await expect(tool.execute({ arguments: ['doctor'] }, { signal: new AbortController().signal }))
      .resolves.toMatchObject({ exitCode: 0, timedOut: false, stdout: 'help\nRisk: read\n' })
    expect(runtime.spawned[0]?.env).toMatchObject({
      LARKSUITE_CLI_NO_UPDATE_NOTIFIER: '1',
      LARKSUITE_CLI_NO_SKILLS_NOTIFIER: '1',
    })
    await runtime.ctx.fiber.dispose()
  })

  it('classifies direct, metadata-declared, cached, and mutating tool calls', async () => {
    const runtime = await makeHarness([
      { stdout: 'Usage\nRisk: read\n' },
      { exitCode: 1, stderr: 'no metadata' },
    ])
    const execute = async (name: string, args: unknown) => runtime.ctx.waterfall(
      runtime.ctx as never,
      'tools/pre-execute',
      { name, arguments: args } as never,
      () => Promise.resolve({ kind: 'allow' as const }),
    )
    await expect(execute('other', {})).resolves.toEqual({ kind: 'allow' })
    await expect(execute('lark_cli', { arguments: ['doctor'] })).resolves.toEqual({ kind: 'allow' })
    await expect(execute('lark_cli', { arguments: ['calendar', '+agenda'] })).resolves.toEqual({ kind: 'allow' })
    await expect(execute('lark_cli', { arguments: ['calendar', '+agenda'] })).resolves.toEqual({ kind: 'allow' })
    await expect(execute('lark_cli', { arguments: ['calendar', 'events', 'create'] }))
      .resolves.toMatchObject({ kind: 'ask' })
    await expect(execute('lark_cli', { arguments: [1] })).resolves.toMatchObject({ kind: 'ask' })
    await expect(execute('lark_cli', null)).resolves.toMatchObject({ kind: 'ask' })
    expect(runtime.spawned).toHaveLength(2)
    await runtime.ctx.fiber.dispose()
  })

  it('persists one managed registration and reuses its in-flight result', async () => {
    channelMocks.register.mockImplementationOnce((options: { onQRCodeReady(info: { url: string }): void }) => {
      options.onQRCodeReady({ url: 'https://verify-managed.test' })
      return Promise.resolve({
        client_id: ' cli_managed ',
        client_secret: 'managed-secret',
        user_info: { tenant_brand: 'lark', open_id: 'ou_owner' },
      })
    })
    const runtime = await makeHarness()
    const first = runtime.gateway.beginManagedRegistration('lark')
    const second = runtime.gateway.beginManagedRegistration('feishu')
    await expect(first).resolves.toEqual({ verificationUrl: 'https://verify-managed.test' })
    await expect(second).resolves.toEqual({ verificationUrl: 'https://verify-managed.test' })
    await runtime.gateway.completeManagedRegistration()
    expect(channelMocks.register).toHaveBeenCalledOnce()
    expect(runtime.config).toMatchObject({
      appId: 'cli_managed',
      brand: 'lark',
      credentialMode: 'managed',
      conversationUserOpenId: 'ou_owner',
    })
    expect(runtime.credentials.get(String(LARK_APP_SECRET_REF))).toBe('managed-secret')
    await expect(runtime.gateway.completeManagedRegistration()).rejects.toThrow(/No managed/)
    await runtime.ctx.fiber.dispose()
  })

  it('rejects failed and incomplete managed registration without losing the previous secret', async () => {
    channelMocks.register.mockImplementationOnce((options: { onQRCodeReady(info: { url: string }): void }) => {
      options.onQRCodeReady({ url: 'https://verify-failed.test' })
      return Promise.resolve({ client_id: '', client_secret: '', user_info: undefined })
    })
    const incomplete = await makeHarness()
    await incomplete.gateway.beginManagedRegistration('feishu')
    await expect(incomplete.gateway.completeManagedRegistration()).rejects.toThrow(/incomplete credentials/)
    await incomplete.ctx.fiber.dispose()

    channelMocks.register.mockImplementationOnce((options: { onQRCodeReady(info: { url: string }): void }) => {
      options.onQRCodeReady({ url: 'https://verify-rollback.test' })
      return Promise.resolve({ client_id: 'cli_new', client_secret: 'new-secret' })
    })
    const rollback = await makeHarness([{ exitCode: 1, stderr: 'init rejected' }])
    rollback.credentials.set(String(LARK_APP_SECRET_REF), 'previous-secret')
    await rollback.gateway.beginManagedRegistration('feishu')
    await expect(rollback.gateway.completeManagedRegistration()).rejects.toThrow('init rejected')
    expect(rollback.credentials.get(String(LARK_APP_SECRET_REF))).toBe('previous-secret')
    await rollback.ctx.fiber.dispose()

    channelMocks.register.mockImplementationOnce(() => Promise.reject(new Error('registration refused')))
    const refused = await makeHarness()
    await expect(refused.gateway.beginManagedRegistration('lark')).rejects.toThrow('registration refused')
    await refused.ctx.fiber.dispose()
  })

  it('rejects missing user identity after a successful device-code command', async () => {
    const runtime = await makeHarness([{ stdout: '{}' }, { stdout: '{}' }])
    runtime.credentials.set(String(LARK_PENDING_USER_AUTH_REF), JSON.stringify({
      deviceCode: 'device',
      scopes: requestedUserScopes(),
    }))
    await expect(runtime.gateway.completeUserAuth()).rejects.toThrow(/without reporting an Open ID/)
    await runtime.ctx.fiber.dispose()
  })

  it('starts, replaces, and stops the private-chat bridge from live settings', async () => {
    const waiting = await makeHarness([], { conversationEnabled: true })
    await (waiting.gateway as unknown as { conversationRefreshTail: Promise<void> }).conversationRefreshTail
    await expect(waiting.gateway.status()).resolves.toMatchObject({
      conversation: { status: 'waiting', diagnostic: '请先连接飞书应用。' },
    })
    await waiting.ctx.fiber.dispose()

    const noUser = await makeHarness([{ stdout: '{}' }], {
      appId: 'cli_app',
      conversationEnabled: true,
    })
    await (noUser.gateway as unknown as { conversationRefreshTail: Promise<void> }).conversationRefreshTail
    const noUserStatus = await noUser.gateway.status()
    expect(noUserStatus.conversation.status).toBe('waiting')
    expect(noUserStatus.conversation.diagnostic).toContain('当前用户授权')
    await noUser.ctx.fiber.dispose()

    const noSecret = await makeHarness([], {
      appId: 'cli_app',
      credentialMode: 'managed',
      conversationEnabled: true,
      conversationUserOpenId: 'ou_user',
    })
    await (noSecret.gateway as unknown as { conversationRefreshTail: Promise<void> }).conversationRefreshTail
    const noSecretStatus = await noSecret.gateway.status()
    expect(noSecretStatus.conversation.status).toBe('waiting')
    expect(noSecretStatus.conversation.diagnostic).toContain('快速连接')
    await noSecret.ctx.fiber.dispose()

    const ready = await makeHarness([], {
      appId: 'cli_app',
      brand: 'lark',
      conversationEnabled: true,
      conversationUserOpenId: 'ou_user',
      conversationCwd: '/workspace',
    })
    ready.credentials.set(String(LARK_APP_SECRET_REF), 'secret')
    const internals = ready.gateway as unknown as { replaceConversation(): Promise<void> }
    await internals.replaceConversation()
    expect(channelMocks.create).toHaveBeenCalledWith(expect.objectContaining({
      appId: 'cli_app',
      domain: 'https://open.larksuite.com',
      policy: { dmMode: 'allowlist', dmAllowlist: ['ou_user'] },
    }))
    expect(channelMocks.connect).toHaveBeenCalled()
    ready.config.conversationEnabled = false
    await internals.replaceConversation()
    expect(channelMocks.dispose).toHaveBeenCalled()
    await ready.ctx.fiber.dispose()
  })

  it('creates and names the stable default conversation workspace', async () => {
    const dshHome = await mkdtemp(join(tmpdir(), 'dsh-lark-home-'))
    roots.push(dshHome)
    vi.stubEnv('DSH_HOME', dshHome)
    const runtime = await makeHarness([], {
      appId: 'cli_app',
      brand: 'feishu',
      conversationEnabled: true,
      conversationUserOpenId: 'ou_user',
      conversationCwd: '',
    })
    runtime.credentials.set(String(LARK_APP_SECRET_REF), 'secret')
    const internals = runtime.gateway as unknown as { replaceConversation(): Promise<void> }
    await internals.replaceConversation()

    const cwd = join(dshHome, 'workspaces', 'lark')
    await expect(stat(cwd)).resolves.toMatchObject({})
    expect(channelMocks.bridgeOptions.at(-1)).toMatchObject({ cwd, workspaceTitle: '飞书' })
    await runtime.ctx.fiber.dispose()
  })

  it('records conversation connection errors and disposes the failed bridge', async () => {
    channelMocks.connect.mockRejectedValueOnce(new Error('socket refused'))
    const runtime = await makeHarness([], {
      appId: 'cli_app',
      conversationEnabled: true,
      conversationUserOpenId: 'ou_user',
    })
    runtime.credentials.set(String(LARK_APP_SECRET_REF), 'secret')
    const internals = runtime.gateway as unknown as { refreshConversation(): Promise<void> }
    await expect(internals.refreshConversation()).rejects.toThrow('socket refused')
    await expect(runtime.gateway.status()).resolves.toMatchObject({
      conversation: { status: 'error', diagnostic: 'socket refused' },
    })
    expect(channelMocks.dispose).toHaveBeenCalled()
    await runtime.ctx.fiber.dispose()
  })

  it('covers CLI fallbacks and fully defaulted settings', async () => {
    const runtime = await makeHarness([
      { exitCode: 7 },
      { stdout: 'not json' },
      { noStreams: true, signal: 'SIGTERM' },
    ], {
      appId: undefined,
      brand: undefined,
      appSecretEnv: undefined,
      cliTimeoutMs: undefined,
      maxOutputBytes: undefined,
      cliConfigDir: undefined,
      credentialMode: undefined,
      registrationTimeoutMs: undefined,
      conversationEnabled: undefined,
      conversationUserOpenId: undefined,
      conversationHandshakeTimeoutMs: undefined,
      conversationResponseTimeoutMs: undefined,
      conversationCwd: undefined,
      conversationTimeZone: undefined,
    })
    const internals = runtime.gateway as unknown as {
      runJson(args: string[]): Promise<unknown>
      collectCli(handle: SubprocessHandle, timedOut: boolean): Promise<unknown>
    }
    await expect(internals.runJson(['auth', 'status'])).rejects.toThrow('exited with 7')
    await expect(internals.runJson(['auth', 'status'])).rejects.toThrow(/invalid JSON/)
    const handle = runtime.ctx.subprocess.spawn({
      argv: ['lark'],
      cwd: runtime.root,
      stdio: { stdin: 'ignore', stdout: { maxBytes: 1 }, stderr: { maxBytes: 1 } },
      graceMs: 1,
    })
    await expect(internals.collectCli(handle, true)).resolves.toEqual({
      exitCode: 0,
      signal: 'SIGTERM',
      timedOut: true,
      stdout: '',
      stderr: '',
    })
    await runtime.ctx.fiber.dispose()
  })

  it('handles remaining credential and CLI error fallbacks', async () => {
    for (const reply of [
      { exitCode: 1, stdout: 'stdout rejected' },
      { exitCode: 1 },
    ]) {
      const runtime = await makeHarness([reply])
      await expect(runtime.gateway.saveApplication({ appId: 'cli_app', brand: 'feishu', appSecret: 'secret' }))
        .rejects.toThrow()
      await runtime.ctx.fiber.dispose()
    }
    const clear = await makeHarness([{ exitCode: 1 }])
    await expect(clear.gateway.clearSecret()).rejects.toThrow(/configuration removal failed/)
    await clear.ctx.fiber.dispose()

    const auth = await makeHarness([{ exitCode: 1 }])
    auth.credentials.set(String(LARK_PENDING_USER_AUTH_REF), JSON.stringify({
      deviceCode: 'device',
      scopes: requestedUserScopes(),
    }))
    await expect(auth.gateway.completeUserAuth()).rejects.toThrow(/authorization failed/)
    await auth.ctx.fiber.dispose()
  })

  it('rolls back a failed managed secret when there was no previous value', async () => {
    channelMocks.register.mockImplementationOnce((options: { onQRCodeReady(info: { url: string }): void }) => {
      options.onQRCodeReady({ url: 'https://verify-new.test' })
      return Promise.resolve({ client_id: 'cli_new', client_secret: 'new-secret' })
    })
    const runtime = await makeHarness([{ exitCode: 1 }])
    await runtime.gateway.beginManagedRegistration('feishu')
    await expect(runtime.gateway.completeManagedRegistration()).rejects.toThrow(/rejected managed/)
    expect(runtime.credentials.has(String(LARK_APP_SECRET_REF))).toBe(false)
    await runtime.ctx.fiber.dispose()
  })

  it('resolves the authorized user from CLI and creates a Feishu bridge in the runtime directory', async () => {
    const runtime = await makeHarness([
      { stdout: JSON.stringify({ identities: { user: { available: true, openId: 'ou_cli' } } }) },
    ], {
      appId: 'cli_app',
      brand: 'feishu',
      conversationEnabled: true,
      conversationUserOpenId: '',
    }, { [String(LARK_APP_SECRET_REF)]: 'secret' })
    await (runtime.gateway as unknown as { conversationRefreshTail: Promise<void> }).conversationRefreshTail
    expect(runtime.config.conversationUserOpenId).toBe('ou_cli')
    expect(channelMocks.create).toHaveBeenCalledWith(expect.objectContaining({
      domain: 'https://open.feishu.cn',
    }))
    await runtime.ctx.fiber.dispose()
  })

  it('keeps the conversation waiting when existing user authorization cannot be read', async () => {
    const runtime = await makeHarness([{ exitCode: 1, stderr: 'not authorized' }], {
      appId: 'cli_app',
      conversationEnabled: true,
    })
    await (runtime.gateway as unknown as { conversationRefreshTail: Promise<void> }).conversationRefreshTail
    const status = await runtime.gateway.status()
    expect(status.conversation.status).toBe('waiting')
    expect(status.conversation.diagnostic).toContain('当前用户授权')
    await runtime.ctx.fiber.dispose()
  })

  it('rejects unknown CLI metadata and survives metadata inspection failures', async () => {
    const runtime = await makeHarness([{ spawnError: new Error('spawn failed') }])
    const internals = runtime.gateway as unknown as { isReadOnlyCommand(args: string[]): Promise<boolean> }
    await expect(internals.isReadOnlyCommand(['api', 'POST'])).resolves.toBe(false)
    await expect(internals.isReadOnlyCommand(['calendar', '+create'])).resolves.toBe(false)
    await runtime.ctx.fiber.dispose()
  })

  it('computes granted capability state from the complete permission response', async () => {
    const permissions = JSON.parse((await import('../src/permissions.ts')).permissionImportTemplate()) as {
      scopes: { tenant: string[]; user: string[] }
    }
    const runtime = await makeHarness([
      { stdout: JSON.stringify({ appId: 'cli_app', brand: 'feishu', identities: {} }) },
      {
        stdout: JSON.stringify({
          data: {
            app: {
              scopes: [
                ...permissions.scopes.tenant.map(scope => ({ scope, token_types: ['tenant'] })),
                ...permissions.scopes.user.map(scope => ({ scope, token_types: ['user'] })),
              ],
            },
          },
        }),
      },
    ])
    await mkdir(String(runtime.config.cliConfigDir), { recursive: true })
    await writeFile(join(String(runtime.config.cliConfigDir), 'config.json'), '{}')
    const status = await runtime.gateway.status()
    expect(status.capabilities.every(item => item.state === 'granted' && item.missingScopes.length === 0)).toBe(true)
    await runtime.ctx.fiber.dispose()
  })

  it('logs a non-Error startup failure without retaining a failed conversation', async () => {
    channelMocks.connect.mockRejectedValueOnce('socket string refusal')
    const runtime = await makeHarness([], {
      appId: 'cli_app',
      conversationEnabled: true,
      conversationUserOpenId: 'ou_user',
    }, { [String(LARK_APP_SECRET_REF)]: 'secret' })
    await (runtime.gateway as unknown as { conversationRefreshTail: Promise<void> }).conversationRefreshTail
    await expect(runtime.gateway.status()).resolves.toMatchObject({
      conversation: { status: 'error', diagnostic: 'socket string refusal' },
    })
    await runtime.ctx.fiber.dispose()
  })

  it('does not clear a newer managed-registration owner when an earlier request fails', async () => {
    let rejectRegistration!: (error: unknown) => void
    channelMocks.register.mockImplementationOnce(() => new Promise((_resolve, reject) => {
      rejectRegistration = reject
    }))
    const runtime = await makeHarness()
    const request = runtime.gateway.beginManagedRegistration('feishu')
    const internals = runtime.gateway as unknown as { pendingRegistration: unknown }
    internals.pendingRegistration = { newer: true }
    rejectRegistration(new Error('old registration failed'))
    await expect(request).rejects.toThrow('old registration failed')
    expect(internals.pendingRegistration).toEqual({ newer: true })
    internals.pendingRegistration = undefined
    await runtime.ctx.fiber.dispose()
  })

  it('stores an empty conversation owner when managed registration omits user info', async () => {
    channelMocks.register.mockImplementationOnce((options: { onQRCodeReady(info: { url: string }): void }) => {
      options.onQRCodeReady({ url: 'https://verify-no-user.test' })
      return Promise.resolve({ client_id: 'cli_app', client_secret: 'secret' })
    })
    const runtime = await makeHarness()
    await runtime.gateway.beginManagedRegistration('lark')
    await runtime.gateway.completeManagedRegistration()
    expect(runtime.config.conversationUserOpenId).toBe('')
    await runtime.ctx.fiber.dispose()
  })

  it('stops conversation refresh work that settles during gateway disposal', async () => {
    let resolveConnect!: () => void
    channelMocks.connect.mockImplementationOnce(() => new Promise<void>((resolve) => {
      resolveConnect = resolve
    }))
    const runtime = await makeHarness([], {
      appId: 'cli_app',
      conversationEnabled: true,
      conversationUserOpenId: 'ou_user',
    }, { [String(LARK_APP_SECRET_REF)]: 'secret' })
    await vi.waitFor(() => { expect(channelMocks.connect).toHaveBeenCalled() })
    const disposal = runtime.ctx.fiber.dispose()
    resolveConnect()
    await disposal
    expect(channelMocks.dispose).toHaveBeenCalled()
  })

  it('leaves disposed gateways idle and suppresses late refresh diagnostics', async () => {
    const runtime = await makeHarness()
    const internals = runtime.gateway as unknown as {
      disposed: boolean
      replaceConversation(): Promise<void>
      refreshConversation(): Promise<void>
    }
    internals.disposed = true
    await expect(internals.replaceConversation()).resolves.toBeUndefined()

    let rejectConnect!: (error: unknown) => void
    channelMocks.connect.mockImplementationOnce(() => new Promise<void>((_resolve, reject) => {
      rejectConnect = reject
    }))
    internals.disposed = false
    Object.assign(runtime.config, {
      appId: 'cli_app',
      conversationEnabled: true,
      conversationUserOpenId: 'ou_user',
    })
    runtime.credentials.set(String(LARK_APP_SECRET_REF), 'secret')
    const refresh = internals.refreshConversation()
    await vi.waitFor(() => { expect(channelMocks.connect).toHaveBeenCalled() })
    internals.disposed = true
    rejectConnect(new Error('late failure'))
    await expect(refresh).rejects.toThrow('late failure')
    await runtime.ctx.fiber.dispose()
  })

  it('does not report a timeout when the caller and deadline both cancel the CLI', async () => {
    let resolveDone!: (value: { exitCode: number | null; signal: string | null }) => void
    const done = new Promise<{ exitCode: number | null; signal: string | null }>((resolve) => {
      resolveDone = resolve
    })
    const runtime = await makeHarness([{ done }], { cliTimeoutMs: 1 })
    const caller = new AbortController()
    const internals = runtime.gateway as unknown as {
      runCli(args: string[], signal: AbortSignal): Promise<{ timedOut: boolean }>
    }
    const result = internals.runCli(['doctor'], caller.signal)
    const spawnedSignal = runtime.spawned[0]?.signal as AbortSignal
    await new Promise<void>((resolve) => {
      if (spawnedSignal.aborted) resolve()
      else spawnedSignal.addEventListener('abort', () => { resolve() }, { once: true })
    })
    caller.abort()
    resolveDone({ exitCode: null, signal: 'SIGTERM' })
    await expect(result).resolves.toMatchObject({ timedOut: false, signal: 'SIGTERM' })
    await runtime.ctx.fiber.dispose()
  })
})
