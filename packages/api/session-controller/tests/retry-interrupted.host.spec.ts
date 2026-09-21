import { describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createAssistantMessage, createSystemMessage, createToolResultMessage, createUserMessage, ToolCallId } from '@deepseek-ai/dsh-llm'
import type { MessageId } from '@deepseek-ai/dsh-llm/brand'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import type { SessionEvent, SessionSeq } from '@deepseek-ai/dsh-session'
import { remoteErrorOf } from '@deepseek-ai/dsh-typert-protocol'
import type { ApiSessionAgentController } from '../src/agent.ts'
import { SessionCommandController } from '../src/commands.ts'
import { resolveInterruptedRetryTarget } from '../src/retry.ts'
import type { SessionRetryInterruptedRequest } from '../src/types.ts'

interface InterruptedFixture {
  readonly session: Session
  readonly events: readonly SessionEvent[]
  readonly promptSeq: SessionSeq
  readonly assistantSeq: SessionSeq
  readonly messageId: MessageId
}

function interruptedFixture(): InterruptedFixture {
  const session = Session.create(SessionId('retry-fixture'))
  session.append('turn/start', { turn: 1 })
  const prompt = createUserMessage({ content: [{ type: 'text', text: 'original prompt' }], source: { kind: 'user' } })
  const promptSeq = session.append('user/message', prompt, { surfaceOp: 'append' }).seq
  const assistant = createAssistantMessage({
    content: [{ type: 'text', text: 'half an answer' }],
    source: { provider: 'p', model: 'm' },
  })
  const assistantSeq = session.append('assistant/message', {
    turn: 1,
    step: 1,
    message: assistant,
    stream: [],
    interrupted: true,
  }, { surfaceOp: 'append' }).seq
  session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
  return { session, events: session.snapshotEvents(), promptSeq, assistantSeq, messageId: assistant.id }
}

describe('resolveInterruptedRetryTarget', () => {
  it('resolves the prompt and interrupted answer from the current surface tail', () => {
    const fixture = interruptedFixture()
    expect(resolveInterruptedRetryTarget(fixture.events, fixture.messageId)).toEqual({
      promptSeq: fixture.promptSeq,
      interruptedSeq: fixture.assistantSeq,
      shadowedSeqs: [fixture.promptSeq, fixture.assistantSeq],
      promptContent: [{ type: 'text', text: 'original prompt' }],
    })
  })

  it('rejects a message id that is not the interrupted tail', () => {
    const fixture = interruptedFixture()
    expect(resolveInterruptedRetryTarget(fixture.events, 'other' as MessageId)).toBeUndefined()
  })

  it('rejects an open turn', () => {
    const fixture = interruptedFixture()
    const events = fixture.events.filter(event => event.type !== 'turn/end')
    expect(resolveInterruptedRetryTarget(events, fixture.messageId)).toBeUndefined()
  })

  it('rejects a turn that ran a tool loop', () => {
    const session = Session.create(SessionId('retry-tool'))
    session.append('turn/start', { turn: 1 })
    const prompt = createUserMessage({ content: [{ type: 'text', text: 'do work' }], source: { kind: 'user' } })
    session.append('user/message', prompt, { surfaceOp: 'append' })
    const call = createAssistantMessage({
      content: [{ type: 'tool-call', id: ToolCallId('call-1'), name: 'tool', arguments: '{}' }],
      source: { provider: 'p', model: 'm' },
    })
    session.append('assistant/message', { turn: 1, step: 1, message: call, stream: [] }, { surfaceOp: 'append' })
    session.append('tool/result', {
      turn: 1,
      step: 1,
      message: createToolResultMessage({
        callId: ToolCallId('call-1'),
        content: [{ type: 'text', text: 'done' }],
        isError: false,
      }),
    }, { surfaceOp: 'append' })
    const interrupted = createAssistantMessage({
      content: [{ type: 'text', text: 'half' }],
      source: { provider: 'p', model: 'm' },
    })
    const assistantSeq = session.append('assistant/message', {
      turn: 1, step: 2, message: interrupted, stream: [], interrupted: true,
    }, { surfaceOp: 'append' }).seq
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    expect(resolveInterruptedRetryTarget(session.snapshotEvents(), interrupted.id)).toBeUndefined()
    expect(assistantSeq).toBeGreaterThan(0)
  })

  it('rejects an empty or single-node surface', () => {
    expect(resolveInterruptedRetryTarget([], 'm' as MessageId)).toBeUndefined()
    const session = Session.create(SessionId('retry-single'))
    const prompt = createUserMessage({ content: [{ type: 'text', text: 'only' }], source: { kind: 'user' } })
    session.append('user/message', prompt, { surfaceOp: 'append' })
    expect(resolveInterruptedRetryTarget(session.snapshotEvents(), 'm' as MessageId)).toBeUndefined()
  })

  it('rejects a completed answer and a non-prompt predecessor', () => {
    const completed = Session.create(SessionId('retry-completed'))
    completed.append('turn/start', { turn: 1 })
    const prompt = createUserMessage({ content: [{ type: 'text', text: 'q' }], source: { kind: 'user' } })
    completed.append('user/message', prompt, { surfaceOp: 'append' })
    const answer = createAssistantMessage({ content: [{ type: 'text', text: 'done' }], source: { provider: 'p', model: 'm' } })
    completed.append('assistant/message', { turn: 1, step: 1, message: answer, stream: [] }, { surfaceOp: 'append' })
    completed.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    expect(resolveInterruptedRetryTarget(completed.snapshotEvents(), answer.id)).toBeUndefined()

    const injected = Session.create(SessionId('retry-injected'))
    injected.append('turn/start', { turn: 1 })
    const context = createUserMessage({ content: [{ type: 'text', text: 'context' }], source: { kind: 'plugin', plugin: 'p' } })
    injected.append('user/message', context, { surfaceOp: 'append' })
    const partial = createAssistantMessage({ content: [{ type: 'text', text: 'half' }], source: { provider: 'p', model: 'm' } })
    injected.append('assistant/message', {
      turn: 1, step: 1, message: partial, stream: [], interrupted: true,
    }, { surfaceOp: 'append' })
    injected.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    expect(resolveInterruptedRetryTarget(injected.snapshotEvents(), partial.id)).toBeUndefined()

    const orphan = Session.create(SessionId('retry-orphan'))
    const orphanPrompt = createUserMessage({ content: [{ type: 'text', text: 'q' }], source: { kind: 'user' } })
    orphan.append('user/message', orphanPrompt, { surfaceOp: 'append' })
    const orphanPartial = createAssistantMessage({ content: [{ type: 'text', text: 'half' }], source: { provider: 'p', model: 'm' } })
    orphan.append('assistant/message', {
      turn: 1, step: 1, message: orphanPartial, stream: [], interrupted: true,
    }, { surfaceOp: 'append' })
    expect(resolveInterruptedRetryTarget(orphan.snapshotEvents(), orphanPartial.id)).toBeUndefined()
  })

  it('keeps a leading system node outside the shadowed range', () => {
    const session = Session.create(SessionId('retry-system'))
    session.append('turn/start', { turn: 1 })
    session.append('system/message', {
      turn: 1, step: 1, message: createSystemMessage('system prompt', 'plugin'),
    }, { surfaceOp: 'append' })
    const prompt = createUserMessage({ content: [{ type: 'text', text: 'original prompt' }], source: { kind: 'user' } })
    const promptSeq = session.append('user/message', prompt, { surfaceOp: 'append' }).seq
    const assistant = createAssistantMessage({ content: [{ type: 'text', text: 'half' }], source: { provider: 'p', model: 'm' } })
    const assistantSeq = session.append('assistant/message', {
      turn: 1, step: 1, message: assistant, stream: [], interrupted: true,
    }, { surfaceOp: 'append' }).seq
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    expect(resolveInterruptedRetryTarget(session.snapshotEvents(), assistant.id)).toEqual({
      promptSeq,
      interruptedSeq: assistantSeq,
      shadowedSeqs: [promptSeq, assistantSeq],
      promptContent: [{ type: 'text', text: 'original prompt' }],
    })
  })

  it('replays the original prompt across an injected runtime-context node', () => {
    const session = Session.create(SessionId('retry-context'))
    session.append('turn/start', { turn: 1 })
    const prompt = createUserMessage({ content: [{ type: 'text', text: 'original prompt' }], source: { kind: 'user' } })
    const promptSeq = session.append('user/message', prompt, { surfaceOp: 'append' }).seq
    const context = createUserMessage({ content: [{ type: 'text', text: '<runtime context>' }], source: { kind: 'plugin', plugin: 'runtime-context' } })
    const contextSeq = session.append('user/message', context, { surfaceOp: 'append' }).seq
    const assistant = createAssistantMessage({ content: [{ type: 'text', text: 'half' }], source: { provider: 'p', model: 'm' } })
    const assistantSeq = session.append('assistant/message', {
      turn: 1, step: 1, message: assistant, stream: [], interrupted: true,
    }, { surfaceOp: 'append' }).seq
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    expect(resolveInterruptedRetryTarget(session.snapshotEvents(), assistant.id)).toEqual({
      promptSeq,
      interruptedSeq: assistantSeq,
      shadowedSeqs: [promptSeq, contextSeq, assistantSeq],
      promptContent: [{ type: 'text', text: 'original prompt' }],
    })
  })

  it('replays a previous retry prompt so an interrupted retry stays retryable', () => {
    const session = Session.create(SessionId('retry-again'))
    session.append('turn/start', { turn: 1 })
    const prompt = createUserMessage({ content: [{ type: 'text', text: 'original prompt' }], source: { kind: 'user' } })
    const promptSeq = session.append('user/message', prompt, { surfaceOp: 'append' }).seq
    const first = createAssistantMessage({ content: [{ type: 'text', text: 'half' }], source: { provider: 'p', model: 'm' } })
    const firstSeq = session.append('assistant/message', {
      turn: 1, step: 1, message: first, stream: [], interrupted: true,
    }, { surfaceOp: 'append' }).seq
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })

    session.append('turn/start', { turn: 2 })
    const replay = createUserMessage({
      content: [{ type: 'text', text: 'original prompt' }],
      source: { kind: 'assistant-retry', retryOf: first.id },
    })
    const replaySeq = session.append('user/message', replay, {
      surfaceOp: { op: 'replace', startSeq: promptSeq, endSeq: firstSeq },
      sourceEventSeqs: [promptSeq, firstSeq],
    }).seq
    const second = createAssistantMessage({ content: [{ type: 'text', text: 'half again' }], source: { provider: 'p', model: 'm' } })
    const secondSeq = session.append('assistant/message', {
      turn: 2, step: 1, message: second, stream: [], interrupted: true,
    }, { surfaceOp: 'append' }).seq
    session.append('turn/end', { turn: 2, reason: { kind: 'completed' } })

    expect(resolveInterruptedRetryTarget(session.snapshotEvents(), second.id)).toEqual({
      promptSeq: replaySeq,
      interruptedSeq: secondSeq,
      shadowedSeqs: [replaySeq, secondSeq],
      promptContent: [{ type: 'text', text: 'original prompt' }],
    })
  })

  it('rejects a second ordinary user or a second assistant inside the turn', () => {
    const steering = Session.create(SessionId('retry-steering'))
    steering.append('turn/start', { turn: 1 })
    const prompt = createUserMessage({ content: [{ type: 'text', text: 'question' }], source: { kind: 'user' } })
    steering.append('user/message', prompt, { surfaceOp: 'append' })
    const steer = createUserMessage({ content: [{ type: 'text', text: 'steer' }], source: { kind: 'user' } })
    steering.append('user/message', steer, { surfaceOp: 'append' })
    const partial = createAssistantMessage({ content: [{ type: 'text', text: 'half' }], source: { provider: 'p', model: 'm' } })
    steering.append('assistant/message', {
      turn: 1, step: 1, message: partial, stream: [], interrupted: true,
    }, { surfaceOp: 'append' })
    steering.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    expect(resolveInterruptedRetryTarget(steering.snapshotEvents(), partial.id)).toBeUndefined()

    const twoAssistants = Session.create(SessionId('retry-two-assistants'))
    twoAssistants.append('turn/start', { turn: 1 })
    const twoPrompt = createUserMessage({ content: [{ type: 'text', text: 'question' }], source: { kind: 'user' } })
    twoAssistants.append('user/message', twoPrompt, { surfaceOp: 'append' })
    const first = createAssistantMessage({ content: [{ type: 'text', text: 'working' }], source: { provider: 'p', model: 'm' } })
    twoAssistants.append('assistant/message', { turn: 1, step: 1, message: first, stream: [] }, { surfaceOp: 'append' })
    const second = createAssistantMessage({ content: [{ type: 'text', text: 'half' }], source: { provider: 'p', model: 'm' } })
    twoAssistants.append('assistant/message', {
      turn: 1, step: 2, message: second, stream: [], interrupted: true,
    }, { surfaceOp: 'append' })
    twoAssistants.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    expect(resolveInterruptedRetryTarget(twoAssistants.snapshotEvents(), second.id)).toBeUndefined()
  })

  it('rejects a tail followed by a later turn', () => {
    const fixture = interruptedFixture()
    fixture.session.append('turn/start', { turn: 2 })
    const later = createUserMessage({ content: [{ type: 'text', text: 'later' }], source: { kind: 'user' } })
    fixture.session.append('user/message', later, { surfaceOp: 'append' })
    expect(resolveInterruptedRetryTarget(fixture.session.snapshotEvents(), fixture.messageId)).toBeUndefined()
  })
})

interface CommandHarness {
  readonly controller: SessionCommandController
  readonly agent: Agent
  readonly retryInterrupted: ReturnType<typeof vi.fn>
  readonly request: SessionRetryInterruptedRequest
}

interface CommandHarnessOptions {
  readonly status?: 'idle' | 'running'
  readonly gate?: Promise<void>
  readonly withoutCapability?: boolean
  readonly dropAgentDuringObserve?: boolean
}

function commandHarness(
  fixture: InterruptedFixture,
  options: CommandHarnessOptions = {},
): CommandHarness {
  const retryInterrupted = vi.fn()
  const agent = {
    id: fixture.session.id,
    session: fixture.session,
    status: options.status ?? 'idle',
    ...options.withoutCapability === true ? {} : { retryInterrupted },
  } as unknown as Agent
  const observation = {
    events: fixture.events,
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
  } as unknown as Context
  const agents = {
    resolveAgent: async () => ({ agent }),
  } as unknown as ApiSessionAgentController
  return {
    controller: new SessionCommandController(ctx, agents, '/tmp'),
    agent,
    retryInterrupted,
    request: { sessionId: fixture.session.id, messageId: fixture.messageId },
  }
}

describe('SessionCommandController.retryInterrupted', () => {
  it('admits one replacement replaying the durable prompt', async () => {
    const fixture = interruptedFixture()
    const harness = commandHarness(fixture)
    await expect(harness.controller.retryInterrupted(harness.request)).resolves.toEqual({ accepted: true })
    expect(harness.retryInterrupted).toHaveBeenCalledTimes(1)
    const [message, replacement] = harness.retryInterrupted.mock.calls[0] as [unknown, {
      readonly startSeq: number
      readonly endSeq: number
      readonly sourceEventSeqs: readonly number[]
    }]
    expect(message).toMatchObject({ content: [{ type: 'text', text: 'original prompt' }], source: { kind: 'assistant-retry', retryOf: fixture.messageId } })
    expect(replacement).toEqual({
      startSeq: fixture.promptSeq,
      endSeq: fixture.assistantSeq,
      sourceEventSeqs: [fixture.promptSeq, fixture.assistantSeq],
    })
  })

  it('rejects a running session', async () => {
    const fixture = interruptedFixture()
    const harness = commandHarness(fixture, { status: 'running' })
    await harness.controller.retryInterrupted(harness.request).then(
      () => { throw new Error('expected rejection') },
      (error: unknown) => { expect(remoteErrorOf(error)?.code).toBe('session/agent-busy') },
    )
    expect(harness.retryInterrupted).not.toHaveBeenCalled()
  })

  it('rejects an unsupported tail', async () => {
    const fixture = interruptedFixture()
    const harness = commandHarness(fixture)
    await harness.controller.retryInterrupted({ sessionId: fixture.session.id, messageId: 'other' as MessageId }).then(
      () => { throw new Error('expected rejection') },
      (error: unknown) => { expect(remoteErrorOf(error)?.code).toBe('session/retry-unavailable') },
    )
    expect(harness.retryInterrupted).not.toHaveBeenCalled()
  })

  it('rejects an agent without the replacement capability', async () => {
    const fixture = interruptedFixture()
    const harness = commandHarness(fixture, { withoutCapability: true })
    await harness.controller.retryInterrupted(harness.request).then(
      () => { throw new Error('expected rejection') },
      (error: unknown) => { expect(remoteErrorOf(error)?.code).toBe('session/retry-unavailable') },
    )
  })

  it('rejects when the agent leaves the registry before admission', async () => {
    const fixture = interruptedFixture()
    const harness = commandHarness(fixture, { dropAgentDuringObserve: true })
    await harness.controller.retryInterrupted(harness.request).then(
      () => { throw new Error('expected rejection') },
      (error: unknown) => { expect(remoteErrorOf(error)?.code).toBe('session/agent-busy') },
    )
    expect(harness.retryInterrupted).not.toHaveBeenCalled()
  })

  it('accepts a double click once', async () => {
    const fixture = interruptedFixture()
    let release = (): void => {}
    const gate = new Promise<void>((resolve) => { release = resolve })
    const harness = commandHarness(fixture, { gate })
    const first = harness.controller.retryInterrupted(harness.request)
    const second = harness.controller.retryInterrupted(harness.request)
    release()
    await expect(Promise.all([first, second])).resolves.toEqual([{ accepted: true }, { accepted: true }])
    expect(harness.retryInterrupted).toHaveBeenCalledTimes(1)
  })
})
