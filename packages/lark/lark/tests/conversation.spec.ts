import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent, AgentHandle } from '@deepseek-ai/dsh-agent'
import { AttachmentId, type FileAttachmentRef, type ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import { createAssistantMessage, type UserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { LarkChannel, NormalizedMessage, SendInput } from '@larksuite/channel'
import { describe, expect, it, vi, type MockedFunction } from 'vitest'
import { LarkConversationBridge, larkSessionId } from '../src/conversation.ts'

interface FakeEvent {
  readonly type: string
  readonly data: Record<string, unknown>
}

interface FakeSession {
  readonly id: SessionId
  readonly header: { readonly cwd?: string }
  readonly events: FakeEvent[]
}

type SessionListener = (session: FakeSession, event: FakeEvent) => void
type RequestListener = (
  payload: unknown,
  next: () => Promise<{ provider: string; model: string; reasoningEffort?: string }>,
) => Promise<{ provider: string; model: string; reasoningEffort?: string }>

const IMAGE_REF: ImageAttachmentRef = {
  attachmentId: AttachmentId('image-attachment'),
  mediaType: 'image/png',
  bytes: 3,
  width: 1,
  height: 1,
  name: 'input.png',
}
const FILE_REF: FileAttachmentRef = {
  attachmentId: AttachmentId('file-attachment'),
  name: 'input.txt',
  bytes: 10,
  mediaType: 'text/plain',
}

function inbound(overrides: Partial<NormalizedMessage> = {}): NormalizedMessage {
  return {
    messageId: 'om_message',
    chatId: 'oc_chat',
    chatType: 'p2p',
    senderId: 'ou_allowed',
    content: '请处理附件',
    rawContentType: 'text',
    resources: [],
    mentions: [],
    mentionAll: false,
    mentionedBot: false,
    createTime: Date.now(),
    ...overrides,
  }
}

function bridgeOptions(overrides: Partial<ConstructorParameters<typeof LarkConversationBridge>[2]> = {}) {
  return {
    appId: 'cli_app',
    allowedSenderId: 'ou_allowed',
    responseTimeoutMs: 1_000,
    cwd: '/workspace',
    timeZone: 'Asia/Shanghai',
    ...overrides,
  }
}

class FakeChannel {
  readonly replies: SendInput[] = []
  readonly connect = vi.fn(async () => {})
  readonly disconnect = vi.fn(async () => {})
  readonly downloadResourceWithMeta = vi.fn(async (
    _messageId: string,
    fileKey: string,
  ): Promise<{ buffer: Buffer; contentType?: string }> => ({
    buffer: Buffer.from(fileKey),
    contentType: fileKey.startsWith('image') ? 'image/png' : 'text/plain; charset=utf-8',
  }))
  private readonly messageHandlers = new Set<(message: NormalizedMessage) => void | Promise<void>>()
  private readonly errorHandlers = new Set<(error: unknown) => void>()

  on(name: string, handler: unknown): () => void {
    const handlers = name === 'message' ? this.messageHandlers : this.errorHandlers
    handlers.add(handler as never)
    return () => { handlers.delete(handler as never) }
  }

  async reply(_message: Pick<NormalizedMessage, 'chatId' | 'messageId' | 'threadId'>, input: SendInput): Promise<object> {
    this.replies.push(input)
    return {}
  }

  async emitMessage(message: NormalizedMessage): Promise<void> {
    await Promise.all([...this.messageHandlers].map(async (handler) => { await handler(message) }))
  }

  emitError(error: unknown): void {
    for (const handler of this.errorHandlers) handler(error)
  }
}

function harness(options: {
  persisted?: boolean
  responseWithAttachments?: boolean
  workspaceExists?: boolean
  attachError?: Error
  live?: boolean
  sessionCwd?: string
  followupError?: unknown
  response?: 'normal' | 'empty' | 'failed' | 'none'
  recognizedText?: string
  selection?: { provider: string; model: string; reasoningEffort?: string }
  omitSessionCwd?: boolean
  createFailureWithConcurrent?: boolean
} = {}): {
  readonly ctx: Context
  readonly followups: UserMessage[]
  readonly created: SessionId[]
  readonly createdCwds: Array<string | undefined>
  readonly setupTimeZones: string[]
  readonly resumed: SessionId[]
  readonly attached: SessionId[]
  readonly workspaceResolves: string[]
  readonly workspaceCreates: string[]
  readonly workspaceCreateTitles: Array<string | undefined>
  readonly disposed: ReturnType<typeof vi.fn>
  readonly scopedDisposed: ReturnType<typeof vi.fn>
  readonly savedImages: ReturnType<typeof vi.fn>
  readonly requestListeners: RequestListener[]
  readonly emitAgentCreated: (agent: Agent) => void
  readonly agentCreatedListeners: Set<(payload: { agent: Agent }) => void>
  readonly emitSessionEvent: (agent: Agent, event: FakeEvent) => void
  readonly agents: Map<SessionId, Agent>
} {
  const listeners = new Set<SessionListener>()
  const agentCreatedListeners = new Set<(payload: { agent: Agent }) => void>()
  const sessions = new Map<SessionId, FakeSession>()
  const agents = new Map<SessionId, Agent>()
  const persistedIds = new Set<SessionId>()
  const persistedEvents = new Map<SessionId, FakeEvent[]>()
  const followups: UserMessage[] = []
  const created: SessionId[] = []
  const createdCwds: Array<string | undefined> = []
  const setupTimeZones: string[] = []
  const resumed: SessionId[] = []
  const attached: SessionId[] = []
  const workspaceResolves: string[] = []
  const workspaceCreates: string[] = []
  const workspaceCreateTitles: Array<string | undefined> = []
  const disposed = vi.fn(async () => {})
  const scopedDisposed = vi.fn(async () => {})
  const savedImages = vi.fn(async () => [IMAGE_REF])
  const requestListeners: RequestListener[] = []
  const agentCtx = {
    plugin: vi.fn(async (_plugin: unknown, config: { timeZone: string }) => {
      setupTimeZones.push(config.timeZone)
      return { dispose: scopedDisposed }
    }),
    on: vi.fn((name: string, listener: unknown) => {
      if (name === 'agent/request') requestListeners.push(listener as RequestListener)
      return () => {}
    }),
  } as unknown as Context
  const workspace = {
    attachSession: vi.fn(async (sessionId: SessionId) => {
      if (options.attachError !== undefined) throw options.attachError
      attached.push(sessionId)
    }),
  }

  const emit = (session: FakeSession, event: FakeEvent): void => {
    session.events.push(event)
    for (const listener of listeners) listener(session, event)
  }
  const makeHandle = (
    sessionId: SessionId,
    cwd = options.sessionCwd ?? '/workspace',
    initialEvents: FakeEvent[] = [],
  ): AgentHandle => {
    const session: FakeSession = {
      id: sessionId,
      header: options.omitSessionCwd === true ? {} : { cwd },
      events: [...initialEvents],
    }
    const agent = {
      id: sessionId,
      ctx: agentCtx,
      session,
      followup(message: UserMessage): void {
        if (options.followupError !== undefined) throw options.followupError
        followups.push(message)
        emit(session, { type: 'user/message', data: message as unknown as Record<string, unknown> })
        if (options.response === 'none') return
        if (options.response === 'empty' || options.response === 'failed') {
          emit(session, {
            type: 'turn/end',
            data: { reason: { kind: options.response === 'failed' ? 'error' : 'completed' } },
          })
          return
        }
        const content = options.responseWithAttachments === true
          ? [
            { type: 'text' as const, text: '已完成' },
            { type: 'image' as const, attachment: IMAGE_REF },
          ]
          : [{ type: 'text' as const, text: '收到' }]
        emit(session, {
          type: 'assistant/message',
          data: {
            message: createAssistantMessage({
              content,
              source: { provider: 'test', model: 'test-model' },
            }),
          },
        })
        emit(session, { type: 'turn/end', data: { reason: { kind: 'completed' } } })
      },
    } as unknown as Agent
    agents.set(sessionId, agent)
    sessions.set(sessionId, session)
    return {
      agent,
      dispose: async () => {
        await disposed()
        persistedEvents.set(sessionId, [...session.events])
        agents.delete(sessionId)
        sessions.delete(sessionId)
      },
    }
  }

  let liveAgent: Agent | undefined
  if (options.live === true) {
    const handle = makeHandle(larkSessionId('cli_app', 'oc_chat'))
    liveAgent = handle.agent
    const session = liveAgent.session as unknown as FakeSession
    session.events.push({
      type: 'user/message',
      data: {
        source: {
          kind: 'lark',
          appId: 'cli_app',
          chatId: 'oc_chat',
          messageId: 'om_existing',
          senderId: 'ou_allowed',
        },
      },
    })
  }

  const ctx = {
    fiber: { assertActive(): void {} },
    logger: { warn: vi.fn() },
    on(name: string, listener: SessionListener | ((payload: { agent: Agent }) => void)): () => void {
      if (name === 'session/event') {
        listeners.add(listener as SessionListener)
        return () => { listeners.delete(listener as SessionListener) }
      }
      if (name === 'agent/created') {
        agentCreatedListeners.add(listener as (payload: { agent: Agent }) => void)
        return () => { agentCreatedListeners.delete(listener as (payload: { agent: Agent }) => void) }
      }
      throw new Error(`unexpected event listener: ${name}`)
    },
    agents: {
      get: (id: SessionId) => agents.get(id),
      list: () => liveAgent === undefined ? [] : [liveAgent],
      create: vi.fn(async ({ sessionId, meta, setup }: {
        sessionId: SessionId
        meta?: { cwd?: string }
        setup?: (ctx: Context) => void | Promise<void>
      }) => {
        if (options.createFailureWithConcurrent === true) {
          makeHandle(sessionId, meta?.cwd)
          throw new Error('unowned race')
        }
        created.push(sessionId)
        persistedIds.add(sessionId)
        createdCwds.push(meta?.cwd)
        await setup?.(agentCtx)
        return makeHandle(sessionId, meta?.cwd)
      }),
      resume: vi.fn(async ({ resumeSessionId, setup }: {
        resumeSessionId: SessionId
        setup?: (ctx: Context) => void | Promise<void>
      }) => {
        resumed.push(resumeSessionId)
        persistedIds.add(resumeSessionId)
        await setup?.(agentCtx)
        return makeHandle(resumeSessionId, undefined, persistedEvents.get(resumeSessionId))
      }),
    },
    agentDefaultModel: {
      currentSelection: () => options.selection ?? { provider: 'test', model: 'test-model' },
    },
    sessionPersistence: {
      stat: vi.fn(async (id: SessionId) => options.persisted === true || persistedIds.has(id)
        ? { header: { id } }
        : undefined),
    },
    sessionQuery: {
      observeSession: vi.fn(async (id: SessionId) => ({
        events: sessions.get(id)?.events ?? persistedEvents.get(id) ?? [],
        [Symbol.dispose](): void {},
      })),
    },
    attachments: {
      saveImages: savedImages,
      saveFile: vi.fn(async () => FILE_REF),
      recognize: vi.fn(async () => options.recognizedText === undefined
        ? { text: '文件内容' }
        : options.recognizedText === '' ? undefined : { text: options.recognizedText }),
      readImage: vi.fn(async () => ({ ref: IMAGE_REF, data: new Uint8Array([1, 2, 3]) })),
    },
    workspaceRegistry: {
      resolveByPath: vi.fn(async (path: string) => {
        workspaceResolves.push(path)
        return options.workspaceExists === false ? undefined : workspace
      }),
      create: vi.fn(async (path: string, title?: string) => {
        workspaceCreates.push(path)
        workspaceCreateTitles.push(title)
        return workspace
      }),
    },
  } as unknown as Context
  return {
    ctx,
    followups,
    created,
    createdCwds,
    setupTimeZones,
    resumed,
    attached,
    workspaceResolves,
    workspaceCreates,
    workspaceCreateTitles,
    disposed,
    scopedDisposed,
    savedImages,
    requestListeners,
    emitAgentCreated: (agent) => {
      for (const listener of agentCreatedListeners) listener({ agent })
    },
    agentCreatedListeners,
    emitSessionEvent: (agent, event) => { emit(agent.session as unknown as FakeSession, event) },
    agents,
  }
}

describe('LarkConversationBridge', () => {
  it('derives stable application-scoped session ids', () => {
    expect(larkSessionId('cli_app', 'oc_chat')).toBe(larkSessionId('cli_app', 'oc_chat'))
    expect(larkSessionId('cli_app', 'oc_chat')).not.toBe(larkSessionId('cli_other', 'oc_chat'))
    expect(larkSessionId('cli_app', 'oc_chat')).not.toBe(larkSessionId('cli_app', 'oc_other'))
    const legacyDigest = createHash('sha256').update('cli_app').update('\0').update('oc_chat').digest('hex')
    expect(larkSessionId('cli_app', 'oc_chat')).not.toBe(SessionId(`lark-${legacyDigest.slice(0, 32)}`))
  })

  it('logs one authorized private message and ignores its redelivery', async () => {
    const runtime = harness()
    const channel = new FakeChannel()
    const bridge = new LarkConversationBridge(runtime.ctx, channel as unknown as LarkChannel, {
      appId: 'cli_app',
      allowedSenderId: 'ou_allowed',
      responseTimeoutMs: 1_000,
      cwd: '/workspace',
      timeZone: 'Asia/Shanghai',
    })
    await bridge.connect()
    await channel.emitMessage(inbound())
    await channel.emitMessage(inbound())

    expect(runtime.created).toEqual([larkSessionId('cli_app', 'oc_chat')])
    expect(runtime.createdCwds).toEqual(['/workspace'])
    expect(runtime.setupTimeZones).toEqual(['Asia/Shanghai', 'Asia/Shanghai'])
    expect(runtime.attached).toEqual([
      larkSessionId('cli_app', 'oc_chat'),
      larkSessionId('cli_app', 'oc_chat'),
    ])
    expect(runtime.followups).toHaveLength(1)
    expect(runtime.followups[0]?.source).toEqual({
      kind: 'lark',
      appId: 'cli_app',
      chatId: 'oc_chat',
      messageId: 'om_message',
      senderId: 'ou_allowed',
    })
    expect(channel.replies).toEqual([{ text: '收到' }])
    await bridge.dispose()
    expect(channel.disconnect).toHaveBeenCalledOnce()
    expect(runtime.disposed).toHaveBeenCalledTimes(2)
  })

  it('stores inbound images and files, logs recognized text, and returns supported response blocks', async () => {
    const runtime = harness({ responseWithAttachments: true })
    const channel = new FakeChannel()
    const bridge = new LarkConversationBridge(runtime.ctx, channel as unknown as LarkChannel, {
      appId: 'cli_app',
      allowedSenderId: 'ou_allowed',
      responseTimeoutMs: 1_000,
      cwd: '/workspace',
      timeZone: 'Asia/Shanghai',
    })
    await bridge.connect()
    await channel.emitMessage(inbound({
      resources: [
        { type: 'image', fileKey: 'image-bytes', fileName: 'input.png' },
        { type: 'file', fileKey: 'file-bytes', fileName: 'input.txt' },
      ],
    }))

    expect(runtime.savedImages).toHaveBeenCalledWith([
      expect.objectContaining({ mediaType: 'image/png', name: 'input.png' }),
    ])
    expect(runtime.followups[0]?.content).toEqual([
      { type: 'text', text: '请处理附件' },
      { type: 'image', attachment: IMAGE_REF },
      { type: 'file', attachment: FILE_REF },
      { type: 'text', text: '[DeepSeek Files extracted text from "input.txt":]\n文件内容' },
    ])
    expect(channel.replies).toEqual([
      { text: '已完成' },
      { image: { source: Buffer.from([1, 2, 3]) } },
    ])
    await bridge.dispose()
  })

  it('supplies the current default route to a model-less Lark Agent', async () => {
    const runtime = harness()
    const channel = new FakeChannel()
    const bridge = new LarkConversationBridge(runtime.ctx, channel as unknown as LarkChannel, {
      appId: 'cli_app',
      allowedSenderId: 'ou_allowed',
      responseTimeoutMs: 1_000,
      cwd: '/workspace',
      timeZone: 'Asia/Shanghai',
    })
    await bridge.connect()
    await channel.emitMessage(inbound())

    const listener = runtime.requestListeners[0]
    expect(listener).toBeDefined()
    await expect(listener?.({}, async () => ({ provider: '', model: '' }))).resolves.toMatchObject({
      provider: 'test',
      model: 'test-model',
    })
    await bridge.dispose()
  })

  it('resumes a persisted chat and rejects groups or other senders', async () => {
    const runtime = harness({ persisted: true, workspaceExists: false, sessionCwd: '/persisted-workspace' })
    const channel = new FakeChannel()
    const bridge = new LarkConversationBridge(runtime.ctx, channel as unknown as LarkChannel, {
      appId: 'cli_app',
      allowedSenderId: 'ou_allowed',
      responseTimeoutMs: 1_000,
      cwd: '/workspace',
      timeZone: 'Asia/Shanghai',
    })
    await bridge.connect()
    await channel.emitMessage(inbound({ chatType: 'group' }))
    await channel.emitMessage(inbound({ senderId: 'ou_other' }))
    await channel.emitMessage(inbound())

    expect(runtime.created).toEqual([])
    expect(runtime.resumed).toEqual([larkSessionId('cli_app', 'oc_chat')])
    expect(runtime.workspaceResolves).toEqual(['/persisted-workspace'])
    expect(runtime.workspaceCreates).toEqual(['/persisted-workspace'])
    expect(runtime.setupTimeZones).toEqual(['Asia/Shanghai'])
    expect(runtime.attached).toEqual([larkSessionId('cli_app', 'oc_chat')])
    expect(runtime.followups).toHaveLength(1)
    await bridge.dispose()
  })

  it('names a newly created Feishu workspace', async () => {
    const runtime = harness({ workspaceExists: false })
    const channel = new FakeChannel()
    const bridge = new LarkConversationBridge(runtime.ctx, channel as unknown as LarkChannel, {
      appId: 'cli_app',
      allowedSenderId: 'ou_allowed',
      responseTimeoutMs: 1_000,
      cwd: '/stable-lark-workspace',
      workspaceTitle: '飞书',
      timeZone: 'Asia/Shanghai',
    })
    await bridge.connect()
    await channel.emitMessage(inbound())

    expect(runtime.workspaceCreates).toEqual(['/stable-lark-workspace'])
    expect(runtime.workspaceCreateTitles).toEqual(['飞书'])
    await bridge.dispose()
  })

  it('disposes an unpublished chat owner when Workspace attachment fails', async () => {
    const runtime = harness({ attachError: new Error('attach failed') })
    const channel = new FakeChannel()
    const bridge = new LarkConversationBridge(runtime.ctx, channel as unknown as LarkChannel, {
      appId: 'cli_app',
      allowedSenderId: 'ou_allowed',
      responseTimeoutMs: 1_000,
      cwd: '/workspace',
      timeZone: 'Asia/Shanghai',
    })
    await bridge.connect()

    await channel.emitMessage(inbound())

    expect(runtime.disposed).toHaveBeenCalledOnce()
    expect(runtime.followups).toEqual([])
    expect(channel.replies).toEqual([{ text: '处理消息时发生错误，请稍后重试。' }])
    await bridge.dispose()
    expect(runtime.disposed).toHaveBeenCalledOnce()
  })

  it('configures a chat Agent that another client resumed first', async () => {
    const runtime = harness({ live: true, sessionCwd: '/live-workspace' })
    const channel = new FakeChannel()
    const bridge = new LarkConversationBridge(runtime.ctx, channel as unknown as LarkChannel, {
      appId: 'cli_app',
      allowedSenderId: 'ou_allowed',
      responseTimeoutMs: 1_000,
      cwd: '/workspace',
      timeZone: 'Asia/Shanghai',
    })
    await bridge.connect()

    expect(runtime.setupTimeZones).toEqual(['Asia/Shanghai'])
    expect(runtime.workspaceResolves).toEqual(['/live-workspace'])
    expect(runtime.attached).toEqual([larkSessionId('cli_app', 'oc_chat')])

    await channel.emitMessage(inbound())

    expect(runtime.created).toEqual([])
    expect(runtime.resumed).toEqual([])
    expect(runtime.followups).toHaveLength(1)
    await bridge.dispose()
    expect(runtime.scopedDisposed).toHaveBeenCalledOnce()
    expect(runtime.disposed).not.toHaveBeenCalled()
  })

  it('connects once, reports channel errors, and ignores late ingress after disposal', async () => {
    const runtime = harness()
    const channel = new FakeChannel()
    const bridge = new LarkConversationBridge(runtime.ctx, channel as unknown as LarkChannel, bridgeOptions())
    await bridge.connect()
    await bridge.connect()
    expect(channel.connect).toHaveBeenCalledOnce()
    channel.emitError('socket warning')
    const handler = [...(channel as unknown as {
      messageHandlers: Set<(message: NormalizedMessage) => Promise<void>>
    }).messageHandlers][0]
    expect(handler).toBeDefined()
    await bridge.dispose()
    await bridge.dispose()
    await handler?.(inbound())
    expect(runtime.followups).toEqual([])
  })

  it('unsubscribes when the initial connection fails', async () => {
    const runtime = harness()
    const channel = new FakeChannel()
    channel.connect.mockRejectedValueOnce(new Error('connect failed'))
    const bridge = new LarkConversationBridge(runtime.ctx, channel as unknown as LarkChannel, bridgeOptions())
    await expect(bridge.connect()).rejects.toThrow('connect failed')
    await channel.emitMessage(inbound())
    expect(runtime.followups).toEqual([])
    await bridge.dispose()
  })

  it('returns an unsupported-content reply for an empty normalized message', async () => {
    const runtime = harness()
    const channel = new FakeChannel()
    const bridge = new LarkConversationBridge(runtime.ctx, channel as unknown as LarkChannel, bridgeOptions())
    await bridge.connect()
    await channel.emitMessage(inbound({
      content: '  ',
      resources: [{ type: 'post', fileKey: 'ignored' } as never],
    }))
    expect(channel.replies).toEqual([{ text: '暂不支持这类消息内容。' }])
    await bridge.dispose()
  })

  it('cancels the pending response when Agent submission throws', async () => {
    const runtime = harness({ followupError: 'submission refused' })
    const channel = new FakeChannel()
    const bridge = new LarkConversationBridge(runtime.ctx, channel as unknown as LarkChannel, bridgeOptions())
    await bridge.connect()
    await channel.emitMessage(inbound())
    expect(channel.replies).toEqual([{ text: '处理消息时发生错误，请稍后重试。' }])
    await bridge.dispose()
  })

  it('returns distinct empty and failed completion messages', async () => {
    for (const [response, expected] of [
      ['empty', '处理已完成，但没有可发送的内容。'],
      ['failed', '本次处理未能完成，请稍后重试。'],
    ] as const) {
      const runtime = harness({ response })
      const channel = new FakeChannel()
      const bridge = new LarkConversationBridge(runtime.ctx, channel as unknown as LarkChannel, bridgeOptions())
      await bridge.connect()
      await channel.emitMessage(inbound({ messageId: `om_${response}` }))
      expect(channel.replies).toEqual([{ text: expected }])
      await bridge.dispose()
    }
  })

  it('times out a turn that produces no durable completion', async () => {
    const runtime = harness({ response: 'none' })
    const channel = new FakeChannel()
    const bridge = new LarkConversationBridge(runtime.ctx, channel as unknown as LarkChannel, bridgeOptions({
      responseTimeoutMs: 5,
    }))
    await bridge.connect()
    await channel.emitMessage(inbound())
    expect(channel.replies).toEqual([{ text: '处理消息时发生错误，请稍后重试。' }])
    await bridge.dispose()
  })

  it('preserves declared and filename-derived image types and file metadata', async () => {
    const runtime = harness()
    const channel = new FakeChannel()
    const bridge = new LarkConversationBridge(runtime.ctx, channel as unknown as LarkChannel, bridgeOptions())
    const internals = bridge as unknown as {
      downloadResource(messageId: string, descriptor: {
        type: 'image' | 'file'
        fileKey: string
        fileName?: string
      }): Promise<{ kind: string; input: Record<string, unknown> }>
    }
    const cases = [
      ['photo.PNG', undefined, 'image/png'],
      ['photo.jpg', 'application/octet-stream', 'image/jpeg'],
      ['photo.jpeg', 'application/octet-stream', 'image/jpeg'],
      ['photo.webp', 'application/octet-stream', 'image/webp'],
      ['photo.gif', 'application/octet-stream', 'image/gif'],
    ] as const
    for (const [fileName, contentType, expected] of cases) {
      channel.downloadResourceWithMeta.mockResolvedValueOnce({
        buffer: Buffer.from('image'),
        ...(contentType === undefined ? {} : { contentType }),
      })
      await expect(internals.downloadResource('om', {
        type: 'image', fileKey: fileName, fileName,
      })).resolves.toMatchObject({ kind: 'image', input: { mediaType: expected, name: fileName } })
    }
    channel.downloadResourceWithMeta.mockResolvedValueOnce({
      buffer: Buffer.from('file'),
      contentType: '  ',
    })
    await expect(internals.downloadResource('om', {
      type: 'file', fileKey: 'file',
    })).resolves.toEqual({
      kind: 'file',
      descriptor: { type: 'file', fileKey: 'file' },
      input: { data: new Uint8Array(Buffer.from('file')) },
    })
    await bridge.dispose()
  })

  it('ignores missing and empty DeepSeek Files recognition output', async () => {
    for (const recognizedText of ['', 'none']) {
      const runtime = harness({ recognizedText: recognizedText === 'none' ? '' : recognizedText })
      if (recognizedText === '') {
        runtime.ctx.attachments.recognize = vi.fn(async () => ({ text: '' }))
      }
      const channel = new FakeChannel()
      const bridge = new LarkConversationBridge(runtime.ctx, channel as unknown as LarkChannel, bridgeOptions())
      await bridge.connect()
      await channel.emitMessage(inbound({
        content: '',
        resources: [{ type: 'file', fileKey: 'file-bytes', fileName: 'input.txt' }],
      }))
      expect(runtime.followups[0]?.content).toEqual([{ type: 'file', attachment: FILE_REF }])
      await bridge.dispose()
    }
  })

  it('routes already-selected and unavailable default model requests unchanged', async () => {
    for (const runtime of [
      harness(),
      harness({ selection: { provider: '', model: '' } }),
      harness({ selection: { provider: 'test', model: 'model', reasoningEffort: 'high' } }),
    ]) {
      const channel = new FakeChannel()
      const bridge = new LarkConversationBridge(runtime.ctx, channel as unknown as LarkChannel, bridgeOptions())
      await bridge.connect()
      await channel.emitMessage(inbound())
      const listener = runtime.requestListeners[0]
      expect(listener).toBeDefined()
      if (runtime.requestListeners === undefined) throw new Error('request listener missing')
      await listener?.({}, async () => ({ provider: 'selected', model: 'selected-model' }))
      await listener?.({}, async () => ({ provider: '', model: '' }))
      await listener?.({}, async () => ({ provider: '', model: '', reasoningEffort: 'low' }))
      await bridge.dispose()
    }
  })

  it('ignores unrelated events while waiting and supports explicit non-Error cancellation', async () => {
    const runtime = harness({ response: 'none' })
    const channel = new FakeChannel()
    const bridge = new LarkConversationBridge(runtime.ctx, channel as unknown as LarkChannel, bridgeOptions())
    const handle = await runtime.ctx.agents.create({ sessionId: SessionId('wait-agent') })
    const other = await runtime.ctx.agents.create({ sessionId: SessionId('other-agent') })
    const internals = bridge as unknown as {
      waitForTurn(agent: Agent, messageId: string): { promise: Promise<unknown>; cancel(reason: unknown): void }
    }
    const pending = internals.waitForTurn(handle.agent, 'target')
    runtime.emitSessionEvent(other.agent, { type: 'turn/end', data: { reason: { kind: 'completed' } } })
    runtime.emitSessionEvent(handle.agent, { type: 'assistant/message', data: { message: createAssistantMessage({ content: [], source: { provider: 'p', model: 'm' } }) } })
    runtime.emitSessionEvent(handle.agent, { type: 'user/message', data: { source: { kind: 'lark', messageId: 'other' } } })
    pending.cancel('cancelled')
    await expect(pending.promise).rejects.toMatchObject({ cause: 'cancelled' })
    await handle.dispose()
    await other.dispose()
    await bridge.dispose()
  })

  it('treats unsupported image metadata as a generic file and omits absent names', async () => {
    const runtime = harness()
    const channel = new FakeChannel()
    channel.downloadResourceWithMeta.mockResolvedValue({
      buffer: Buffer.from('unknown'),
      contentType: 'application/octet-stream',
    })
    const bridge = new LarkConversationBridge(runtime.ctx, channel as unknown as LarkChannel, bridgeOptions())
    const internals = bridge as unknown as {
      downloadResource(messageId: string, descriptor: { type: 'image'; fileKey: string; fileName?: string }): Promise<unknown>
    }
    await expect(internals.downloadResource('om', { type: 'image', fileKey: 'unknown' }))
      .resolves.toMatchObject({ kind: 'file', input: { mediaType: 'application/octet-stream' } })
    await bridge.dispose()
  })

  it('suppresses channel and message failures after disposal', async () => {
    const error = new Error('late message failure')
    Reflect.deleteProperty(error, 'stack')
    const runtime = harness({ followupError: error })
    const channel = new FakeChannel()
    const bridge = new LarkConversationBridge(runtime.ctx, channel as unknown as LarkChannel, bridgeOptions())
    await bridge.connect()
    const internals = bridge as unknown as { handleMessage(message: NormalizedMessage): Promise<void> }
    const errorHandler = [...(channel as unknown as { errorHandlers: Set<(error: unknown) => void> }).errorHandlers][0]
    await bridge.dispose()
    errorHandler?.('late channel error')
    await internals.handleMessage(inbound())
    expect(channel.replies).toEqual([])
  })

  it('logs an error-reply failure without escaping the channel callback', async () => {
    const runtime = harness({ followupError: new Error('submission failed') })
    const channel = new FakeChannel()
    vi.spyOn(channel, 'reply').mockRejectedValue(new Error('reply failed'))
    const bridge = new LarkConversationBridge(runtime.ctx, channel as unknown as LarkChannel, bridgeOptions())
    await bridge.connect()
    await expect(channel.emitMessage(inbound())).resolves.toBeUndefined()
    await bridge.dispose()
  })

  it('disposes directly ensured Agents and uses configured cwd when the Session header omits it', async () => {
    const runtime = harness({ omitSessionCwd: true })
    const channel = new FakeChannel()
    const bridge = new LarkConversationBridge(runtime.ctx, channel as unknown as LarkChannel, bridgeOptions())
    const internals = bridge as unknown as { ensureAgent(chatId: string): Promise<Agent> }
    await internals.ensureAgent('oc_direct')
    await bridge.dispose()
    expect(runtime.workspaceResolves).toContain('/workspace')
    expect(runtime.disposed).toHaveBeenCalled()
  })

  it('shares one in-flight Agent creation and recovers from a concurrent owner', async () => {
    const runtime = harness()
    const channel = new FakeChannel()
    const bridge = new LarkConversationBridge(runtime.ctx, channel as unknown as LarkChannel, bridgeOptions())
    const internals = bridge as unknown as {
      ensureAgent(chatId: string): Promise<Agent>
      handles: Map<SessionId, AgentHandle>
    }
    const originalCreate = runtime.ctx.agents.create.bind(runtime.ctx.agents)
    let releaseCreate!: () => void
    const barrier = new Promise<void>((resolve) => { releaseCreate = resolve })
    runtime.ctx.agents.create = vi.fn(async (options: Parameters<typeof originalCreate>[0]) => {
      await barrier
      return originalCreate(options)
    })
    const first = internals.ensureAgent('oc_shared')
    const second = internals.ensureAgent('oc_shared')
    releaseCreate()
    await expect(Promise.all([first, second])).resolves.toEqual([await first, await first])

    const sessionId = larkSessionId('cli_app', 'oc_concurrent')
    const concurrentHandle = await originalCreate({ sessionId })
    runtime.ctx.agents.create = vi.fn(async () => { throw new Error('lost creation race') })
    internals.handles.set(sessionId, concurrentHandle)
    await expect(internals.ensureAgent('oc_concurrent')).resolves.toBe(concurrentHandle.agent)
    await bridge.dispose()
  })

  it('configures an unowned live Agent and cleans up when Workspace attachment fails', async () => {
    const runtime = harness({ live: true, attachError: new Error('live attach failed'), omitSessionCwd: true })
    const channel = new FakeChannel()
    const bridge = new LarkConversationBridge(runtime.ctx, channel as unknown as LarkChannel, bridgeOptions())
    const internals = bridge as unknown as { ensureAgent(chatId: string): Promise<Agent> }
    await expect(internals.ensureAgent('oc_chat')).rejects.toThrow('live attach failed')
    expect(runtime.scopedDisposed).toHaveBeenCalled()
    await bridge.dispose()
  })

  it('decrements overlapping message ownership before disposing the Agent', async () => {
    const runtime = harness()
    const channel = new FakeChannel()
    const bridge = new LarkConversationBridge(runtime.ctx, channel as unknown as LarkChannel, bridgeOptions())
    const internals = bridge as unknown as {
      ensureAgent(chatId: string): Promise<Agent>
      releaseIdleAgent(sessionId: SessionId): Promise<void>
      activeMessages: Map<SessionId, number>
    }
    const agent = await internals.ensureAgent('oc_overlap')
    internals.activeMessages.set(agent.id, 2)
    await internals.releaseIdleAgent(agent.id)
    expect(runtime.disposed).not.toHaveBeenCalled()
    await internals.releaseIdleAgent(agent.id)
    expect(runtime.disposed).toHaveBeenCalledOnce()
    await internals.releaseIdleAgent(SessionId('missing'))
    await bridge.dispose()
  })

  it('ignores unrelated discovered Agents and already-configured Lark Agents', async () => {
    const runtime = harness({ live: true })
    const channel = new FakeChannel()
    const bridge = new LarkConversationBridge(runtime.ctx, channel as unknown as LarkChannel, bridgeOptions())
    await bridge.connect()
    const unrelated = await runtime.ctx.agents.create({ sessionId: SessionId('unrelated') })
    runtime.emitAgentCreated(unrelated.agent)
    const existing = runtime.agents.get(larkSessionId('cli_app', 'oc_chat'))
    expect(existing).toBeDefined()
    if (existing !== undefined) runtime.emitAgentCreated(existing)
    await vi.waitFor(() => { expect(runtime.attached).toHaveLength(1) })
    await unrelated.dispose()
    await bridge.dispose()
  })

  it('handles already-aborted and repeatedly-settled response waits', async () => {
    const runtime = harness({ response: 'none' })
    const channel = new FakeChannel()
    const bridge = new LarkConversationBridge(runtime.ctx, channel as unknown as LarkChannel, bridgeOptions())
    const handle = await runtime.ctx.agents.create({ sessionId: SessionId('aborted-wait') })
    await bridge.dispose()
    const internals = bridge as unknown as {
      waitForTurn(agent: Agent, messageId: string): { promise: Promise<unknown>; cancel(reason: unknown): void }
    }
    const pending = internals.waitForTurn(handle.agent, 'message')
    pending.cancel(new Error('second cancellation'))
    await expect(pending.promise).rejects.toThrow(/disposed/)
    await handle.dispose()
  })

  it('reports discovered-Agent configuration failures before disposal and suppresses them after', async () => {
    const runtime = harness({ attachError: new Error('discovered attach failed') })
    const channel = new FakeChannel()
    const bridge = new LarkConversationBridge(runtime.ctx, channel as unknown as LarkChannel, bridgeOptions())
    await bridge.connect()
    const handle = await runtime.ctx.agents.create({ sessionId: SessionId('discovered') })
    runtime.emitSessionEvent(handle.agent, {
      type: 'user/message',
      data: { source: { kind: 'lark', appId: 'cli_app', messageId: 'old' } },
    })
    runtime.emitAgentCreated(handle.agent)
    await vi.waitFor(() => { expect(runtime.scopedDisposed).toHaveBeenCalled() })

    const lateHandler = [...runtime.agentCreatedListeners][0]
    await bridge.dispose()
    lateHandler?.({ agent: handle.agent })
    await Promise.resolve()
    await handle.dispose()
  })

  it('uses an Error message when no diagnostic stack is available', async () => {
    const error = new Error('stackless submission')
    Reflect.deleteProperty(error, 'stack')
    const runtime = harness({ followupError: error })
    const channel = new FakeChannel()
    const bridge = new LarkConversationBridge(runtime.ctx, channel as unknown as LarkChannel, bridgeOptions())
    await bridge.connect()
    await channel.emitMessage(inbound())
    expect(channel.replies).toEqual([{ text: '处理消息时发生错误，请稍后重试。' }])
    await bridge.dispose()
  })

  it('stores a declared image without inventing a filename', async () => {
    const runtime = harness()
    const channel = new FakeChannel()
    channel.downloadResourceWithMeta.mockResolvedValueOnce({
      buffer: Buffer.from('image'),
      contentType: 'image/png',
    })
    const bridge = new LarkConversationBridge(runtime.ctx, channel as unknown as LarkChannel, bridgeOptions())
    const internals = bridge as unknown as {
      downloadResource(messageId: string, descriptor: { type: 'image'; fileKey: string }): Promise<unknown>
    }
    await expect(internals.downloadResource('om', { type: 'image', fileKey: 'image' }))
      .resolves.toMatchObject({ kind: 'image', input: { mediaType: 'image/png' } })
    await bridge.dispose()
  })

  it('ignores post-acceptance non-terminal events until explicit cancellation', async () => {
    const runtime = harness({ response: 'none' })
    const channel = new FakeChannel()
    const bridge = new LarkConversationBridge(runtime.ctx, channel as unknown as LarkChannel, bridgeOptions())
    const handle = await runtime.ctx.agents.create({ sessionId: SessionId('accepted-wait') })
    const internals = bridge as unknown as {
      waitForTurn(agent: Agent, messageId: string): { promise: Promise<unknown>; cancel(reason: unknown): void }
    }
    const pending = internals.waitForTurn(handle.agent, 'message')
    runtime.emitSessionEvent(handle.agent, {
      type: 'user/message',
      data: { source: { kind: 'lark', messageId: 'message' } },
    })
    runtime.emitSessionEvent(handle.agent, { type: 'tool/result', data: {} })
    pending.cancel(new Error('test complete'))
    await expect(pending.promise).rejects.toThrow('test complete')
    await handle.dispose()
    await bridge.dispose()
  })

  it('propagates Agent creation failures when no concurrent owner exists', async () => {
    const runtime = harness()
    runtime.ctx.agents.create = vi.fn(async () => { throw new Error('create failed') })
    const channel = new FakeChannel()
    const bridge = new LarkConversationBridge(runtime.ctx, channel as unknown as LarkChannel, bridgeOptions())
    const internals = bridge as unknown as { ensureAgent(chatId: string): Promise<Agent> }
    await expect(internals.ensureAgent('oc_failed')).rejects.toThrow('create failed')
    await bridge.dispose()
  })

  it('propagates a creation failure when an unowned concurrent Agent appears', async () => {
    const runtime = harness({ createFailureWithConcurrent: true })
    const channel = new FakeChannel()
    const bridge = new LarkConversationBridge(runtime.ctx, channel as unknown as LarkChannel, bridgeOptions())
    const internals = bridge as unknown as { ensureAgent(chatId: string): Promise<Agent> }
    await expect(internals.ensureAgent('oc_unowned')).rejects.toThrow('unowned race')
    runtime.agents.delete(larkSessionId('cli_app', 'oc_unowned'))
    await bridge.dispose()
  })

  it('adopts a concurrently owned Agent after losing the creation race', async () => {
    const runtime = harness()
    const channel = new FakeChannel()
    const bridge = new LarkConversationBridge(runtime.ctx, channel as unknown as LarkChannel, bridgeOptions())
    const internals = bridge as unknown as {
      ensureAgent(chatId: string): Promise<Agent>
      handles: Map<SessionId, AgentHandle>
    }
    const createMock = (runtime.ctx.agents as unknown as {
      create: MockedFunction<typeof runtime.ctx.agents.create>
    }).create
    const originalCreate = createMock.getMockImplementation()
    expect(originalCreate).toBeDefined()
    createMock.mockImplementation(async (options) => {
      if (originalCreate === undefined) throw new Error('create implementation missing')
      const handle = await originalCreate(options)
      internals.handles.set(handle.agent.id, handle)
      throw new Error('creation lost after ownership transferred')
    })
    const adopted = await internals.ensureAgent('oc_adopted')
    expect(adopted.id).toBe(larkSessionId('cli_app', 'oc_adopted'))
    await bridge.dispose()
  })

  it('uses the live default-route callback installed for externally resumed Agents', async () => {
    const runtime = harness({ live: true })
    const channel = new FakeChannel()
    const bridge = new LarkConversationBridge(runtime.ctx, channel as unknown as LarkChannel, bridgeOptions())
    await bridge.connect()
    const listener = runtime.requestListeners[0]
    await expect(listener?.({}, async () => ({ provider: '', model: '' }))).resolves.toMatchObject({
      provider: 'test',
      model: 'test-model',
    })
    await bridge.dispose()
  })
})
