import { describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { AttachmentId } from '@deepseek-ai/dsh-attachment'
import { brandString } from '@deepseek-ai/dsh-brand'
import { createAssistantMessage, createToolResultMessage, createUserMessage, ToolCallId } from '@deepseek-ai/dsh-llm'
import type { MessageId } from '@deepseek-ai/dsh-llm/brand'
import { Session, SessionId, SessionSeq } from '@deepseek-ai/dsh-session'
import type { UserMessage } from '@deepseek-ai/dsh-session'
import { remoteErrorOf } from '@deepseek-ai/dsh-typert-protocol'
import type { ApiSessionAgentController } from '../src/agent.ts'
import { SessionCommandController } from '../src/commands.ts'
import { resolveResendTarget, resolveResumeTurn } from '../src/turn-actions.ts'
import type { SessionResendRequest } from '../src/types.ts'

/** One ordinary prompt of a synthetic Session, addressed by its durable id. */
function promptOf(session: Session, text: string, attachment?: FileAttachment): UserMessage {
  const prompt = createUserMessage({
    content: attachment === undefined
      ? [{ type: 'text', text }]
      : [{ type: 'text', text }, { type: 'file', attachment }],
    source: { kind: 'user' },
  })
  session.append('user/message', prompt, { surfaceOp: 'append' })
  return prompt
}

/** Durable file reference carried by an attachment-bearing prompt. */
interface FileAttachment {
  readonly attachmentId: AttachmentId
  readonly name: string
  readonly bytes: number
}

const FILE_ATTACHMENT: FileAttachment = {
  attachmentId: brandString<AttachmentId>('att-1'),
  name: 'notes.txt',
  bytes: 4,
}

function answer(
  session: Session,
  turn: number,
  step: number,
  text: string,
  options: { readonly interrupted?: boolean } = {},
) {
  const message = createAssistantMessage({ content: [{ type: 'text', text }], source: { provider: 'p', model: 'm' } })
  const event = session.append('assistant/message', {
    turn,
    step,
    message,
    stream: [],
    ...options.interrupted === true ? { interrupted: true } : {},
  }, { surfaceOp: 'append' })
  return { message, seq: event.seq }
}

/** A completed Turn whose single answer holds no tool. */
function plainFixture(): { readonly session: Session; readonly prompt: UserMessage } {
  const session = Session.create(SessionId('resend-plain'))
  session.append('turn/start', { turn: 1 })
  const prompt = promptOf(session, 'original prompt')
  answer(session, 1, 1, 'full answer')
  session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
  return { session, prompt }
}

/** A completed Turn that ran a tool loop: call, result, then a closing answer. */
function toolFixture(): {
  readonly session: Session
  readonly prompt: UserMessage
  readonly attemptSeq: SessionSeq
  readonly callSeq: SessionSeq
  readonly closingSeq: SessionSeq
} {
  const session = Session.create(SessionId('resend-tools'))
  session.append('turn/start', { turn: 1 })
  const prompt = promptOf(session, 'do work')
  session.append('step/start', { turn: 1, step: 1 })
  const attemptSeq = session.append('assistant/attempt', { turn: 1, step: 1, stream: [] }).seq
  const call = createAssistantMessage({
    content: [{ type: 'tool-call', id: ToolCallId('call-1'), name: 'tool', arguments: '{}' }],
    source: { provider: 'p', model: 'm' },
  })
  session.append('assistant/message', { turn: 1, step: 1, message: call, stream: [] }, { surfaceOp: 'append' })
  const callSeq = session.append('tool/call', {
    turn: 1, step: 1, callId: ToolCallId('call-1'), name: 'tool', arguments: '{}',
  }).seq
  session.append('tool/result', {
    turn: 1,
    step: 1,
    message: createToolResultMessage({
      callId: ToolCallId('call-1'),
      content: [{ type: 'text', text: 'tool says no' }],
      isError: true,
    }),
    error: { name: 'UNKNOWN_TOOL', code: 'UNKNOWN_TOOL' },
  }, { surfaceOp: 'append', sourceEventSeqs: [callSeq] })
  session.append('step/end', { turn: 1, step: 1 })
  const closing = answer(session, 1, 2, 'the tool failed')
  session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
  return { session, prompt, attemptSeq, callSeq, closingSeq: closing.seq }
}

/** A stopped Turn that settled as a log-only attempt and never a surface answer. */
function attemptFixture(): { readonly session: Session; readonly prompt: UserMessage } {
  const session = Session.create(SessionId('resend-attempt'))
  session.append('turn/start', { turn: 1 })
  const prompt = promptOf(session, 'original prompt')
  session.append('assistant/attempt', { turn: 1, step: 1, stream: [] })
  session.append('turn/end', { turn: 1, reason: { kind: 'aborted', reason: { kind: 'user' } } })
  return { session, prompt }
}

describe('resolveResendTarget', () => {
  it('resolves a completed answer turn from its opening prompt', () => {
    const { session, prompt } = plainFixture()
    const events = session.snapshotEvents()
    expect(resolveResendTarget(events, prompt.id)).toEqual({
      promptSeq: SessionSeq(1),
      endSeq: SessionSeq(2),
      sourceSeqs: [SessionSeq(1), SessionSeq(2)],
      promptContent: [{ type: 'text', text: 'original prompt' }],
    })
  })

  it('covers a turn that ran tools, citing its attempt and tool call', () => {
    const { session, prompt, attemptSeq, callSeq, closingSeq } = toolFixture()
    const events = session.snapshotEvents()
    expect(resolveResendTarget(events, prompt.id)).toEqual({
      promptSeq: SessionSeq(1),
      endSeq: closingSeq,
      sourceSeqs: [SessionSeq(1), attemptSeq, SessionSeq(4), callSeq, SessionSeq(6), SessionSeq(8)],
      promptContent: [{ type: 'text', text: 'do work' }],
    })
    expect(events.filter(event => event.type === 'tool/result').map(event => event.seq)).toEqual([SessionSeq(6)])
  })

  it('ends a log-only attempt turn at its prompt and cites the attempt', () => {
    const { session, prompt } = attemptFixture()
    const attemptSeq = session.snapshotEvents().findLast(event => event.type === 'assistant/attempt')?.seq
    expect(attemptSeq).toBeDefined()
    expect(resolveResendTarget(session.snapshotEvents(), prompt.id)).toEqual({
      promptSeq: SessionSeq(1),
      endSeq: SessionSeq(1),
      sourceSeqs: [SessionSeq(1), attemptSeq],
      promptContent: [{ type: 'text', text: 'original prompt' }],
    })
  })

  it('rejects an unknown message id and a non-replayable prompt', () => {
    const { session, prompt } = plainFixture()
    expect(resolveResendTarget(session.snapshotEvents(), 'other' as MessageId)).toBeUndefined()

    const injected = Session.create(SessionId('resend-injected'))
    injected.append('turn/start', { turn: 1 })
    const context = createUserMessage({ content: [{ type: 'text', text: 'context' }], source: { kind: 'plugin', plugin: 'p' } })
    injected.append('user/message', context, { surfaceOp: 'append' })
    injected.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    expect(resolveResendTarget(injected.snapshotEvents(), context.id)).toBeUndefined()
    expect(resolveResendTarget([], prompt.id)).toBeUndefined()
  })

  it('rejects a turn that is open, missing, or historical', () => {
    const open = attemptFixture()
    open.session.append('turn/start', { turn: 2 })
    expect(resolveResendTarget(open.session.snapshotEvents(), open.prompt.id)).toBeUndefined()

    const missing = Session.create(SessionId('resend-no-turn'))
    const orphan = promptOf(missing, 'q')
    expect(resolveResendTarget(missing.snapshotEvents(), orphan.id)).toBeUndefined()

    const { session, prompt } = plainFixture()
    session.append('turn/start', { turn: 2 })
    const later = promptOf(session, 'later')
    session.append('turn/end', { turn: 2, reason: { kind: 'completed' } })
    expect(resolveResendTarget(session.snapshotEvents(), prompt.id)).toBeUndefined()
    // The later Turn's own prompt is the only resendable one.
    expect(resolveResendTarget(session.snapshotEvents(), later.id)).toBeDefined()
  })

  it('rejects a prompt appended after its turn closed', () => {
    const { session } = plainFixture()
    const stray = promptOf(session, 'after the turn')
    expect(resolveResendTarget(session.snapshotEvents(), stray.id)).toBeUndefined()
  })

  it('rejects a prompt the current surface already shadowed', () => {
    const { session, prompt } = plainFixture()
    const events = session.snapshotEvents()
    const promptSeq = events.find(event => event.type === 'user/message')?.seq as SessionSeq
    const checkpoint = createUserMessage({ content: [{ type: 'text', text: 'summary' }], source: { kind: 'plugin', plugin: 'compact' } })
    session.append('user/message', checkpoint, {
      surfaceOp: { op: 'replace', startSeq: promptSeq, endSeq: promptSeq },
      sourceEventSeqs: [promptSeq],
    })
    expect(resolveResendTarget(session.snapshotEvents(), prompt.id)).toBeUndefined()
  })

  it('rejects a turn holding a second replayable prompt', () => {
    const session = Session.create(SessionId('resend-steering'))
    session.append('turn/start', { turn: 1 })
    const prompt = promptOf(session, 'question')
    const steer = createUserMessage({ content: [{ type: 'text', text: 'steer' }], source: { kind: 'user' } })
    session.append('user/message', steer, { surfaceOp: 'append' })
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    expect(resolveResendTarget(session.snapshotEvents(), prompt.id)).toBeUndefined()
    expect(resolveResendTarget(session.snapshotEvents(), steer.id)).toBeUndefined()
  })

  it('replays a previous resend prompt so an edited turn stays resendable', () => {
    const { session, prompt } = plainFixture()
    const events = session.snapshotEvents()
    const promptSeq = events.find(event => event.type === 'user/message')?.seq as SessionSeq
    const answerSeq = events.findLast(event => event.type === 'assistant/message')?.seq as SessionSeq
    session.append('turn/start', { turn: 2 })
    const replay = createUserMessage({
      content: [{ type: 'text', text: 'edited prompt' }],
      source: { kind: 'assistant-retry', retryOf: { kind: 'user-message', messageId: prompt.id } },
    })
    const replaySeq = session.append('user/message', replay, {
      surfaceOp: { op: 'replace', startSeq: promptSeq, endSeq: answerSeq },
      sourceEventSeqs: [promptSeq, answerSeq],
    }).seq
    answer(session, 2, 1, 'second answer')
    session.append('turn/end', { turn: 2, reason: { kind: 'completed' } })
    expect(resolveResendTarget(session.snapshotEvents(), replay.id)).toEqual({
      promptSeq: replaySeq,
      endSeq: SessionSeq(6),
      sourceSeqs: [replaySeq, SessionSeq(6)],
      promptContent: [{ type: 'text', text: 'edited prompt' }],
    })
    // The shadowed original is no longer a current surface node.
    expect(resolveResendTarget(session.snapshotEvents(), prompt.id)).toBeUndefined()
  })
})

describe('resolveResumeTurn', () => {
  it('resumes a user-stopped turn', () => {
    const { session } = attemptFixture()
    expect(resolveResumeTurn(session.snapshotEvents())).toBe(1)
  })

  it('resumes a crash-repaired turn', () => {
    const session = Session.create(SessionId('resume-repaired'))
    session.append('turn/start', { turn: 1 })
    promptOf(session, 'q')
    session.append('turn/end', { turn: 1, reason: { kind: 'interrupted' } })
    expect(resolveResumeTurn(session.snapshotEvents())).toBe(1)
  })

  it('rejects a finished, capped, failed, or blocked turn', () => {
    for (const reason of [
      { kind: 'completed' } as const,
      { kind: 'max-tokens' } as const,
      { kind: 'error', error: { message: 'boom', code: 'SERVER' } } as const,
      { kind: 'blocked' } as const,
    ]) {
      const session = Session.create(SessionId(`resume-${reason.kind}`))
      session.append('turn/start', { turn: 1 })
      promptOf(session, 'q')
      session.append('turn/end', { turn: 1, reason })
      expect(resolveResumeTurn(session.snapshotEvents())).toBeUndefined()
    }
  })

  it('rejects an open turn, an empty log, and a turn without exactly one prompt', () => {
    const open = attemptFixture()
    open.session.append('turn/start', { turn: 2 })
    expect(resolveResumeTurn(open.session.snapshotEvents())).toBeUndefined()
    expect(resolveResumeTurn([])).toBeUndefined()

    const injected = Session.create(SessionId('resume-injected'))
    injected.append('turn/start', { turn: 1 })
    const context = createUserMessage({ content: [{ type: 'text', text: 'c' }], source: { kind: 'plugin', plugin: 'p' } })
    injected.append('user/message', context, { surfaceOp: 'append' })
    injected.append('turn/end', { turn: 1, reason: { kind: 'aborted', reason: { kind: 'user' } } })
    expect(resolveResumeTurn(injected.snapshotEvents())).toBeUndefined()
  })
})

interface CommandHarness {
  readonly controller: SessionCommandController
  readonly agent: Agent
  readonly resendPrompt: ReturnType<typeof vi.fn>
  readonly resumeTurn: ReturnType<typeof vi.fn>
  readonly request: SessionResendRequest
}

interface CommandHarnessOptions {
  readonly status?: 'idle' | 'running'
  readonly gate?: Promise<void>
  readonly withoutCapability?: 'resend' | 'resume'
  readonly dropAgentDuringObserve?: boolean
  readonly resumeThrows?: boolean
  /** Attachment-recognition stub for an edited prompt that carries a file. */
  readonly recognize?: ReturnType<typeof vi.fn>
}

function commandHarness(
  session: Session,
  prompt: UserMessage,
  options: CommandHarnessOptions = {},
): CommandHarness {
  const resendPrompt = vi.fn()
  const resumeTurn = options.resumeThrows === true
    ? vi.fn(() => { throw new Error('driver left the idle phase') })
    : vi.fn()
  const agent = {
    id: session.id,
    session,
    status: options.status ?? 'idle',
    ...options.withoutCapability === 'resend' ? {} : { resendPrompt },
    ...options.withoutCapability === 'resume' ? {} : { resumeTurn },
  } as unknown as Agent
  const observation = {
    events: session.snapshotEvents(),
    [Symbol.dispose]: () => {},
  }
  let live: Agent | undefined = agent
  const ctx = {
    sessionQuery: {
      observeSession: async () => {
        if (options.gate !== undefined) await options.gate
        if (options.dropAgentDuringObserve === true) live = undefined
        return observation
      },
    },
    agents: { get: () => live },
    logger: { warn: () => {} },
    ...options.recognize === undefined ? {} : { attachments: { recognize: options.recognize } },
  } as unknown as Context
  const agents = {
    resolveAgent: async () => ({ agent }),
  } as unknown as ApiSessionAgentController
  return {
    controller: new SessionCommandController(ctx, agents, '/tmp'),
    agent,
    resendPrompt,
    resumeTurn,
    request: { sessionId: session.id, messageId: prompt.id },
  }
}

describe('SessionCommandController.resend', () => {
  it('admits one replacement replaying the durable prompt verbatim', async () => {
    const { session, prompt } = plainFixture()
    const harness = commandHarness(session, prompt)
    await expect(harness.controller.resend(harness.request)).resolves.toEqual({ accepted: true })
    expect(harness.resendPrompt).toHaveBeenCalledTimes(1)
    const [message, replacement] = harness.resendPrompt.mock.calls[0] as [unknown, {
      readonly startSeq: number
      readonly endSeq: number
      readonly sourceEventSeqs: readonly number[]
    }]
    expect(message).toMatchObject({
      content: [{ type: 'text', text: 'original prompt' }],
      source: { kind: 'assistant-retry', retryOf: { kind: 'user-message', messageId: prompt.id } },
    })
    expect(replacement).toEqual({
      startSeq: SessionSeq(1),
      endSeq: SessionSeq(2),
      sourceEventSeqs: [SessionSeq(1), SessionSeq(2)],
    })
  })

  it('shadows the addressed turn so its old tool material cites no new request', async () => {
    const { session, prompt, attemptSeq, callSeq, closingSeq } = toolFixture()
    const harness = commandHarness(session, prompt)
    await harness.controller.resend(harness.request)
    const replacement = harness.resendPrompt.mock.calls[0]?.[1] as {
      readonly startSeq: number
      readonly endSeq: number
      readonly sourceEventSeqs: readonly number[]
    }
    expect(replacement).toEqual({
      startSeq: SessionSeq(1),
      endSeq: closingSeq,
      sourceEventSeqs: [SessionSeq(1), attemptSeq, SessionSeq(4), callSeq, SessionSeq(6), SessionSeq(8)],
    })
  })

  it('replaces the prompt text while keeping durable attachment references', async () => {
    const session = Session.create(SessionId('resend-attachment'))
    session.append('turn/start', { turn: 1 })
    const prompt = promptOf(session, 'summarize', FILE_ATTACHMENT)
    answer(session, 1, 1, 'summary')
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    const recognize = vi.fn(async () => ({ text: 'extracted body' }))
    const harness = commandHarness(session, prompt, { recognize })
    await expect(harness.controller.resend({
      sessionId: session.id,
      messageId: prompt.id,
      content: [{ type: 'text', text: 'edited' }],
    })).resolves.toEqual({ accepted: true })
    expect(recognize).toHaveBeenCalledTimes(1)
    const [message] = harness.resendPrompt.mock.calls[0] as [UserMessage]
    expect(message.content).toMatchObject([
      { type: 'text', text: 'edited' },
      { type: 'file', attachment: FILE_ATTACHMENT },
      { type: 'text', text: expect.stringContaining('extracted body') },
    ])
  })

  it('rejects non-text and blank edited content', async () => {
    const { session, prompt } = plainFixture()
    const harness = commandHarness(session, prompt)
    await harness.controller.resend({
      ...harness.request,
      content: [{ type: 'image', mediaType: 'image/png', data: 'AAAA' }],
    }).then(
      () => { throw new Error('expected rejection') },
      (error: unknown) => { expect(remoteErrorOf(error)?.code).toBe('gateway/bad-request') },
    )
    await harness.controller.resend({
      ...harness.request,
      content: [{ type: 'text', text: '   ' }],
    }).then(
      () => { throw new Error('expected rejection') },
      (error: unknown) => { expect(remoteErrorOf(error)?.code).toBe('gateway/bad-request') },
    )
    expect(harness.resendPrompt).not.toHaveBeenCalled()
  })

  it('rejects a running session, an unsupported message, and a dropped agent', async () => {
    const { session, prompt } = plainFixture()
    const running = commandHarness(session, prompt, { status: 'running' })
    await running.controller.resend(running.request).then(
      () => { throw new Error('expected rejection') },
      (error: unknown) => { expect(remoteErrorOf(error)?.code).toBe('session/agent-busy') },
    )
    expect(running.resendPrompt).not.toHaveBeenCalled()

    const unsupported = commandHarness(session, prompt)
    await unsupported.controller.resend({ sessionId: session.id, messageId: 'other' as MessageId }).then(
      () => { throw new Error('expected rejection') },
      (error: unknown) => { expect(remoteErrorOf(error)?.code).toBe('session/resend-unavailable') },
    )

    const dropped = commandHarness(session, prompt, { dropAgentDuringObserve: true })
    await dropped.controller.resend(dropped.request).then(
      () => { throw new Error('expected rejection') },
      (error: unknown) => { expect(remoteErrorOf(error)?.code).toBe('session/agent-busy') },
    )
    expect(dropped.resendPrompt).not.toHaveBeenCalled()
  })

  it('rejects an agent without the replacement capability', async () => {
    const { session, prompt } = plainFixture()
    const harness = commandHarness(session, prompt, { withoutCapability: 'resend' })
    await harness.controller.resend(harness.request).then(
      () => { throw new Error('expected rejection') },
      (error: unknown) => { expect(remoteErrorOf(error)?.code).toBe('session/resend-unavailable') },
    )
  })

  it('accepts a double click once', async () => {
    const { session, prompt } = plainFixture()
    let release = (): void => {}
    const gate = new Promise<void>((resolve) => { release = resolve })
    const harness = commandHarness(session, prompt, { gate })
    const first = harness.controller.resend(harness.request)
    const second = harness.controller.resend(harness.request)
    release()
    await expect(Promise.all([first, second])).resolves.toEqual([{ accepted: true }, { accepted: true }])
    expect(harness.resendPrompt).toHaveBeenCalledTimes(1)
  })
})

describe('SessionCommandController.resume', () => {
  it('admits one resume of the stopped turn', async () => {
    const { session, prompt } = attemptFixture()
    const harness = commandHarness(session, prompt)
    await expect(harness.controller.resume({ sessionId: session.id })).resolves.toEqual({ accepted: true })
    expect(harness.resumeTurn).toHaveBeenCalledTimes(1)
  })

  it('rejects a running session, an unsupported tail, and a dropped agent', async () => {
    const { session, prompt } = attemptFixture()
    const running = commandHarness(session, prompt, { status: 'running' })
    await running.controller.resume({ sessionId: session.id }).then(
      () => { throw new Error('expected rejection') },
      (error: unknown) => { expect(remoteErrorOf(error)?.code).toBe('session/resume-unavailable') },
    )

    const finished = plainFixture()
    const unsupported = commandHarness(finished.session, finished.prompt)
    await unsupported.controller.resume({ sessionId: finished.session.id }).then(
      () => { throw new Error('expected rejection') },
      (error: unknown) => { expect(remoteErrorOf(error)?.code).toBe('session/resume-unavailable') },
    )
    expect(unsupported.resumeTurn).not.toHaveBeenCalled()

    const dropped = commandHarness(session, prompt, { dropAgentDuringObserve: true })
    await dropped.controller.resume({ sessionId: session.id }).then(
      () => { throw new Error('expected rejection') },
      (error: unknown) => { expect(remoteErrorOf(error)?.code).toBe('session/agent-busy') },
    )
  })

  it('rejects an agent without the resume capability or whose driver left the idle phase', async () => {
    const { session, prompt } = attemptFixture()
    const without = commandHarness(session, prompt, { withoutCapability: 'resume' })
    await without.controller.resume({ sessionId: session.id }).then(
      () => { throw new Error('expected rejection') },
      (error: unknown) => { expect(remoteErrorOf(error)?.code).toBe('session/resume-unavailable') },
    )

    const raced = commandHarness(session, prompt, { resumeThrows: true })
    await raced.controller.resume({ sessionId: session.id }).then(
      () => { throw new Error('expected rejection') },
      (error: unknown) => { expect(remoteErrorOf(error)?.code).toBe('session/agent-busy') },
    )
  })

  it('accepts a double click once', async () => {
    const { session, prompt } = attemptFixture()
    let release = (): void => {}
    const gate = new Promise<void>((resolve) => { release = resolve })
    const harness = commandHarness(session, prompt, { gate })
    const first = harness.controller.resume({ sessionId: session.id })
    const second = harness.controller.resume({ sessionId: session.id })
    release()
    await expect(Promise.all([first, second])).resolves.toEqual([{ accepted: true }, { accepted: true }])
    expect(harness.resumeTurn).toHaveBeenCalledTimes(1)
  })
})
