import { describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createAssistantMessage, createSystemMessage, createToolResultMessage, createUserMessage, ToolCallId } from '@deepseek-ai/dsh-llm'
import type { MessageId } from '@deepseek-ai/dsh-llm/brand'
import { Session, SessionId, SessionLogOffset, SessionSeq } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { remoteErrorOf } from '@deepseek-ai/dsh-typert-protocol'
import type { ApiSessionAgentController } from '../src/agent.ts'
import { SessionCommandController } from '../src/commands.ts'
import { resolveInterruptedRetryTarget } from '../src/retry.ts'
import type { SessionInterruptedRetryTarget, SessionRetryInterruptedRequest } from '../src/types.ts'

interface InterruptedFixture {
  readonly session: Session
  readonly events: readonly SessionEvent[]
  readonly promptSeq: SessionSeq
  readonly assistantSeq: SessionSeq
  readonly messageId: MessageId
  readonly target: SessionInterruptedRetryTarget
}

const messageTarget = (messageId: MessageId): SessionInterruptedRetryTarget =>
  ({ kind: 'assistant-message', messageId })

const attemptTarget = (seq: SessionSeq): SessionInterruptedRetryTarget =>
  ({ kind: 'assistant-attempt', seq })

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
  return {
    session,
    events: session.snapshotEvents(),
    promptSeq,
    assistantSeq,
    messageId: assistant.id,
    target: messageTarget(assistant.id),
  }
}

/** A user-stopped turn that settled as a log-only attempt, never a surface message. */
function attemptFixture(): InterruptedFixture {
  const session = Session.create(SessionId('retry-attempt-fixture'))
  session.append('turn/start', { turn: 1 })
  const prompt = createUserMessage({ content: [{ type: 'text', text: 'original prompt' }], source: { kind: 'user' } })
  const promptSeq = session.append('user/message', prompt, { surfaceOp: 'append' }).seq
  const attemptSeq = session.append('assistant/attempt', {
    turn: 1,
    step: 1,
    stream: [],
  }).seq
  session.append('turn/end', { turn: 1, reason: { kind: 'aborted', reason: { kind: 'user' } } })
  return {
    session,
    events: session.snapshotEvents(),
    promptSeq,
    assistantSeq: attemptSeq,
    messageId: 'unused' as MessageId,
    target: attemptTarget(attemptSeq),
  }
}

/** A normally completed Turn whose single answer is an ordinary surface message. */
function completedFixture(): InterruptedFixture {
  const session = Session.create(SessionId('retry-completed-fixture'))
  session.append('turn/start', { turn: 1 })
  const prompt = createUserMessage({ content: [{ type: 'text', text: 'original prompt' }], source: { kind: 'user' } })
  const promptSeq = session.append('user/message', prompt, { surfaceOp: 'append' }).seq
  const assistant = createAssistantMessage({
    content: [{ type: 'text', text: 'full answer' }],
    source: { provider: 'p', model: 'm' },
  })
  const assistantSeq = session.append('assistant/message', {
    turn: 1,
    step: 1,
    message: assistant,
    stream: [],
  }, { surfaceOp: 'append' }).seq
  session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
  return {
    session,
    events: session.snapshotEvents(),
    promptSeq,
    assistantSeq,
    messageId: assistant.id,
    target: messageTarget(assistant.id),
  }
}

describe('resolveInterruptedRetryTarget', () => {
  it('resolves the prompt and interrupted message from the current surface tail', () => {
    const fixture = interruptedFixture()
    expect(resolveInterruptedRetryTarget(fixture.events, fixture.target)).toEqual({
      promptSeq: fixture.promptSeq,
      endSeq: fixture.assistantSeq,
      sourceSeqs: [fixture.promptSeq, fixture.assistantSeq],
      promptContent: [{ type: 'text', text: 'original prompt' }],
    })
  })

  it('resolves a log-only attempt turn from its durable seq', () => {
    const fixture = attemptFixture()
    expect(resolveInterruptedRetryTarget(fixture.events, fixture.target)).toEqual({
      promptSeq: fixture.promptSeq,
      endSeq: fixture.promptSeq,
      sourceSeqs: [fixture.promptSeq, fixture.assistantSeq],
      promptContent: [{ type: 'text', text: 'original prompt' }],
    })
  })

  it('rejects an address that names no durable settlement', () => {
    const fixture = interruptedFixture()
    expect(resolveInterruptedRetryTarget(fixture.events, messageTarget('other' as MessageId))).toBeUndefined()
    expect(resolveInterruptedRetryTarget(fixture.events, attemptTarget(SessionSeq(999)))).toBeUndefined()
    // A message address cannot name an attempt and vice versa.
    expect(resolveInterruptedRetryTarget(fixture.events, attemptTarget(fixture.assistantSeq))).toBeUndefined()
    expect(resolveInterruptedRetryTarget(attemptFixture().events, messageTarget('other' as MessageId))).toBeUndefined()
  })

  it('resolves an ordinary completed surface message as the latest safe answer', () => {
    const session = Session.create(SessionId('retry-completed-address'))
    session.append('turn/start', { turn: 1 })
    const prompt = createUserMessage({ content: [{ type: 'text', text: 'q' }], source: { kind: 'user' } })
    const promptSeq = session.append('user/message', prompt, { surfaceOp: 'append' }).seq
    const answer = createAssistantMessage({ content: [{ type: 'text', text: 'done' }], source: { provider: 'p', model: 'm' } })
    const answerSeq = session.append('assistant/message', { turn: 1, step: 1, message: answer, stream: [] }, { surfaceOp: 'append' }).seq
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    expect(resolveInterruptedRetryTarget(session.snapshotEvents(), messageTarget(answer.id))).toEqual({
      promptSeq,
      endSeq: answerSeq,
      sourceSeqs: [promptSeq, answerSeq],
      promptContent: [{ type: 'text', text: 'q' }],
    })
  })

  it('rejects a completed message whose turn did not end completed', () => {
    for (const reason of [
      { kind: 'max-tokens' } as const,
      { kind: 'error', error: { message: 'boom', code: 'SERVER' } } as const,
      { kind: 'aborted', reason: { kind: 'user' } } as const,
    ]) {
      const session = Session.create(SessionId(`retry-completed-${reason.kind}`))
      session.append('turn/start', { turn: 1 })
      const prompt = createUserMessage({ content: [{ type: 'text', text: 'q' }], source: { kind: 'user' } })
      session.append('user/message', prompt, { surfaceOp: 'append' })
      const answer = createAssistantMessage({ content: [{ type: 'text', text: 'done' }], source: { provider: 'p', model: 'm' } })
      session.append('assistant/message', { turn: 1, step: 1, message: answer, stream: [] }, { surfaceOp: 'append' })
      session.append('turn/end', { turn: 1, reason })
      expect(resolveInterruptedRetryTarget(session.snapshotEvents(), messageTarget(answer.id))).toBeUndefined()
    }
  })

  it('rejects a completed message in a turn with tools or a second settlement', () => {
    const tools = Session.create(SessionId('retry-completed-tools'))
    tools.append('turn/start', { turn: 1 })
    const toolsPrompt = createUserMessage({ content: [{ type: 'text', text: 'q' }], source: { kind: 'user' } })
    tools.append('user/message', toolsPrompt, { surfaceOp: 'append' })
    tools.append('tool/call', { turn: 1, step: 1, callId: ToolCallId('call-1'), name: 'tool', arguments: '{}' })
    const toolAnswer = createAssistantMessage({ content: [{ type: 'text', text: 'done' }], source: { provider: 'p', model: 'm' } })
    tools.append('assistant/message', { turn: 1, step: 1, message: toolAnswer, stream: [] }, { surfaceOp: 'append' })
    tools.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    expect(resolveInterruptedRetryTarget(tools.snapshotEvents(), messageTarget(toolAnswer.id))).toBeUndefined()

    const twoSettlements = Session.create(SessionId('retry-completed-two'))
    twoSettlements.append('turn/start', { turn: 1 })
    const twoPrompt = createUserMessage({ content: [{ type: 'text', text: 'q' }], source: { kind: 'user' } })
    twoSettlements.append('user/message', twoPrompt, { surfaceOp: 'append' })
    const earlier = createAssistantMessage({ content: [{ type: 'text', text: 'working' }], source: { provider: 'p', model: 'm' } })
    twoSettlements.append('assistant/message', { turn: 1, step: 1, message: earlier, stream: [] }, { surfaceOp: 'append' })
    const closing = createAssistantMessage({ content: [{ type: 'text', text: 'done' }], source: { provider: 'p', model: 'm' } })
    twoSettlements.append('assistant/message', { turn: 1, step: 2, message: closing, stream: [] }, { surfaceOp: 'append' })
    twoSettlements.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    expect(resolveInterruptedRetryTarget(twoSettlements.snapshotEvents(), messageTarget(closing.id))).toBeUndefined()
  })

  it('rejects a completed answer that is not the current surface tail', () => {
    const session = Session.create(SessionId('retry-completed-history'))
    session.append('turn/start', { turn: 1 })
    const prompt = createUserMessage({ content: [{ type: 'text', text: 'q' }], source: { kind: 'user' } })
    session.append('user/message', prompt, { surfaceOp: 'append' })
    const answer = createAssistantMessage({ content: [{ type: 'text', text: 'done' }], source: { provider: 'p', model: 'm' } })
    session.append('assistant/message', { turn: 1, step: 1, message: answer, stream: [] }, { surfaceOp: 'append' })
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    session.append('turn/start', { turn: 2 })
    const later = createUserMessage({ content: [{ type: 'text', text: 'later' }], source: { kind: 'user' } })
    session.append('user/message', later, { surfaceOp: 'append' })
    expect(resolveInterruptedRetryTarget(session.snapshotEvents(), messageTarget(answer.id))).toBeUndefined()
  })

  it('rejects an open turn for both addresses', () => {
    const messages = interruptedFixture()
    expect(resolveInterruptedRetryTarget(
      messages.events.filter(event => event.type !== 'turn/end'), messages.target,
    )).toBeUndefined()
    const attempt = attemptFixture()
    expect(resolveInterruptedRetryTarget(
      attempt.events.filter(event => event.type !== 'turn/end'), attempt.target,
    )).toBeUndefined()
  })

  it('rejects a turn that ran a tool loop for both addresses', () => {
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
    const attemptSeq = session.append('assistant/attempt', { turn: 1, step: 2, stream: [] }).seq
    const interrupted = createAssistantMessage({
      content: [{ type: 'text', text: 'half' }],
      source: { provider: 'p', model: 'm' },
    })
    const assistantSeq = session.append('assistant/message', {
      turn: 1, step: 2, message: interrupted, stream: [], interrupted: true,
    }, { surfaceOp: 'append' }).seq
    session.append('turn/end', { turn: 1, reason: { kind: 'aborted', reason: { kind: 'user' } } })
    expect(resolveInterruptedRetryTarget(session.snapshotEvents(), messageTarget(interrupted.id))).toBeUndefined()
    expect(resolveInterruptedRetryTarget(session.snapshotEvents(), attemptTarget(attemptSeq))).toBeUndefined()
    expect(assistantSeq).toBeGreaterThan(0)
  })

  it('rejects an empty attempt turn with no replayable prompt', () => {
    const session = Session.create(SessionId('retry-attempt-no-prompt'))
    session.append('turn/start', { turn: 1 })
    const context = createUserMessage({ content: [{ type: 'text', text: 'context' }], source: { kind: 'plugin', plugin: 'p' } })
    session.append('user/message', context, { surfaceOp: 'append' })
    const attemptSeq = session.append('assistant/attempt', { turn: 1, step: 1, stream: [] }).seq
    session.append('turn/end', { turn: 1, reason: { kind: 'aborted', reason: { kind: 'user' } } })
    expect(resolveInterruptedRetryTarget(session.snapshotEvents(), attemptTarget(attemptSeq))).toBeUndefined()
  })

  it('rejects an attempt whose turn ended completed or errored', () => {
    for (const reason of [
      { kind: 'completed' } as const,
      { kind: 'max-tokens' } as const,
      { kind: 'error', error: { message: 'boom', code: 'SERVER' } } as const,
    ]) {
      const session = Session.create(SessionId(`retry-attempt-${reason.kind}`))
      session.append('turn/start', { turn: 1 })
      const prompt = createUserMessage({ content: [{ type: 'text', text: 'q' }], source: { kind: 'user' } })
      session.append('user/message', prompt, { surfaceOp: 'append' })
      const attemptSeq = session.append('assistant/attempt', { turn: 1, step: 1, stream: [] }).seq
      session.append('turn/end', { turn: 1, reason })
      expect(resolveInterruptedRetryTarget(session.snapshotEvents(), attemptTarget(attemptSeq))).toBeUndefined()
    }
  })

  it('accepts a crash-repaired interrupted attempt turn', () => {
    const session = Session.create(SessionId('retry-attempt-repaired'))
    session.append('turn/start', { turn: 1 })
    const prompt = createUserMessage({ content: [{ type: 'text', text: 'q' }], source: { kind: 'user' } })
    const promptSeq = session.append('user/message', prompt, { surfaceOp: 'append' }).seq
    const attemptSeq = session.append('assistant/attempt', { turn: 1, step: 1, stream: [] }).seq
    session.append('turn/end', { turn: 1, reason: { kind: 'interrupted' } })
    expect(resolveInterruptedRetryTarget(session.snapshotEvents(), attemptTarget(attemptSeq))).toEqual({
      promptSeq,
      endSeq: promptSeq,
      sourceSeqs: [promptSeq, attemptSeq],
      promptContent: [{ type: 'text', text: 'q' }],
    })
  })

  it('rejects a turn with more than one assistant settlement', () => {
    const session = Session.create(SessionId('retry-attempt-two'))
    session.append('turn/start', { turn: 1 })
    const prompt = createUserMessage({ content: [{ type: 'text', text: 'q' }], source: { kind: 'user' } })
    session.append('user/message', prompt, { surfaceOp: 'append' })
    const first = session.append('assistant/attempt', { turn: 1, step: 1, stream: [] }).seq
    const second = session.append('assistant/attempt', { turn: 1, step: 1, stream: [] }).seq
    session.append('turn/end', { turn: 1, reason: { kind: 'aborted', reason: { kind: 'user' } } })
    expect(resolveInterruptedRetryTarget(session.snapshotEvents(), attemptTarget(second))).toBeUndefined()
    expect(resolveInterruptedRetryTarget(session.snapshotEvents(), attemptTarget(first))).toBeUndefined()
  })

  it('rejects an attempt followed by a surface message in the same turn', () => {
    const session = Session.create(SessionId('retry-attempt-then-message'))
    session.append('turn/start', { turn: 1 })
    const prompt = createUserMessage({ content: [{ type: 'text', text: 'q' }], source: { kind: 'user' } })
    session.append('user/message', prompt, { surfaceOp: 'append' })
    const attemptSeq = session.append('assistant/attempt', { turn: 1, step: 1, stream: [] }).seq
    const message = createAssistantMessage({ content: [{ type: 'text', text: 'half' }], source: { provider: 'p', model: 'm' } })
    session.append('assistant/message', {
      turn: 1, step: 1, message, stream: [], interrupted: true,
    }, { surfaceOp: 'append' })
    session.append('turn/end', { turn: 1, reason: { kind: 'aborted', reason: { kind: 'user' } } })
    expect(resolveInterruptedRetryTarget(session.snapshotEvents(), attemptTarget(attemptSeq))).toBeUndefined()
  })

  it('rejects a scheduled model retry chain inside the turn', () => {
    const session = Session.create(SessionId('retry-attempt-scheduled'))
    session.append('turn/start', { turn: 1 })
    const prompt = createUserMessage({ content: [{ type: 'text', text: 'q' }], source: { kind: 'user' } })
    session.append('user/message', prompt, { surfaceOp: 'append' })
    session.append('step/start', { turn: 1, step: 1 })
    session.append('assistant/attempt', { turn: 1, step: 1, stream: [] })
    session.append('llm/retry', {
      retryId: 'r' as never, turn: 1, step: 1, provider: 'p', mode: 'normal', policyKey: 'k',
      retry: 1, maxRetries: 2, delayMs: 1, failure: { message: 'x', code: 'SERVER' },
    })
    const attemptSeq = session.append('assistant/attempt', { turn: 1, step: 1, stream: [] }).seq
    session.append('step/end', { turn: 1, step: 1 })
    session.append('turn/end', { turn: 1, reason: { kind: 'aborted', reason: { kind: 'user' } } })
    expect(resolveInterruptedRetryTarget(session.snapshotEvents(), attemptTarget(attemptSeq))).toBeUndefined()
  })

  it('rejects a single-node surface without a replayable prompt', () => {
    expect(resolveInterruptedRetryTarget([], attemptTarget(SessionSeq(0)))).toBeUndefined()
    const session = Session.create(SessionId('retry-attempt-single'))
    const context = createUserMessage({ content: [{ type: 'text', text: 'only' }], source: { kind: 'plugin', plugin: 'p' } })
    session.append('user/message', context, { surfaceOp: 'append' })
    const attemptSeq = session.append('assistant/attempt', { turn: 1, step: 1, stream: [] }).seq
    session.append('turn/end', { turn: 1, reason: { kind: 'aborted', reason: { kind: 'user' } } })
    expect(resolveInterruptedRetryTarget(session.snapshotEvents(), attemptTarget(attemptSeq))).toBeUndefined()
  })

  it('rejects a non-prompt predecessor in a message turn', () => {
    const injected = Session.create(SessionId('retry-injected'))
    injected.append('turn/start', { turn: 1 })
    const context = createUserMessage({ content: [{ type: 'text', text: 'context' }], source: { kind: 'plugin', plugin: 'p' } })
    injected.append('user/message', context, { surfaceOp: 'append' })
    const partial = createAssistantMessage({ content: [{ type: 'text', text: 'half' }], source: { provider: 'p', model: 'm' } })
    injected.append('assistant/message', {
      turn: 1, step: 1, message: partial, stream: [], interrupted: true,
    }, { surfaceOp: 'append' })
    injected.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    expect(resolveInterruptedRetryTarget(injected.snapshotEvents(), messageTarget(partial.id))).toBeUndefined()

    const orphan = Session.create(SessionId('retry-orphan'))
    const orphanPrompt = createUserMessage({ content: [{ type: 'text', text: 'q' }], source: { kind: 'user' } })
    orphan.append('user/message', orphanPrompt, { surfaceOp: 'append' })
    const orphanPartial = createAssistantMessage({ content: [{ type: 'text', text: 'half' }], source: { provider: 'p', model: 'm' } })
    orphan.append('assistant/message', {
      turn: 1, step: 1, message: orphanPartial, stream: [], interrupted: true,
    }, { surfaceOp: 'append' })
    expect(resolveInterruptedRetryTarget(orphan.snapshotEvents(), messageTarget(orphanPartial.id))).toBeUndefined()
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
    expect(resolveInterruptedRetryTarget(session.snapshotEvents(), messageTarget(assistant.id))).toEqual({
      promptSeq,
      endSeq: assistantSeq,
      sourceSeqs: [promptSeq, assistantSeq],
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
    const attemptSeq = session.append('assistant/attempt', { turn: 1, step: 1, stream: [] }).seq
    session.append('turn/end', { turn: 1, reason: { kind: 'aborted', reason: { kind: 'user' } } })
    expect(resolveInterruptedRetryTarget(session.snapshotEvents(), attemptTarget(attemptSeq))).toEqual({
      promptSeq,
      endSeq: contextSeq,
      sourceSeqs: [promptSeq, contextSeq, attemptSeq],
      promptContent: [{ type: 'text', text: 'original prompt' }],
    })
  })

  it('replays a released legacy bare retryOf prompt', () => {
    const session = Session.create(SessionId('retry-legacy'))
    session.append('turn/start', { turn: 1 })
    const prompt = createUserMessage({ content: [{ type: 'text', text: 'original prompt' }], source: { kind: 'user' } })
    const promptSeq = session.append('user/message', prompt, { surfaceOp: 'append' }).seq
    const first = createAssistantMessage({ content: [{ type: 'text', text: 'half' }], source: { provider: 'p', model: 'm' } })
    const firstSeq = session.append('assistant/message', {
      turn: 1, step: 1, message: first, stream: [], interrupted: true,
    }, { surfaceOp: 'append' }).seq
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })

    session.append('turn/start', { turn: 2 })
    // 0.1.20 wrote the bare interrupted message id; readers must still accept it.
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

    expect(replay.source).toEqual({ kind: 'assistant-retry', retryOf: first.id })
    // A persisted legacy log restores unchanged and still resolves.
    const restored = Session.fromRestore(
      session.id,
      structuredClone(session.snapshotEvents()),
      structuredClone(session.header),
      SessionLogOffset(0),
      'detached',
    )
    expect(resolveInterruptedRetryTarget(restored.snapshotEvents(), messageTarget(second.id))).toEqual({
      promptSeq: replaySeq,
      endSeq: secondSeq,
      sourceSeqs: [replaySeq, secondSeq],
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
      source: { kind: 'assistant-retry', retryOf: messageTarget(first.id) },
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

    expect(resolveInterruptedRetryTarget(session.snapshotEvents(), messageTarget(second.id))).toEqual({
      promptSeq: replaySeq,
      endSeq: secondSeq,
      sourceSeqs: [replaySeq, secondSeq],
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
    const attemptSeq = steering.append('assistant/attempt', { turn: 1, step: 1, stream: [] }).seq
    steering.append('turn/end', { turn: 1, reason: { kind: 'aborted', reason: { kind: 'user' } } })
    expect(resolveInterruptedRetryTarget(steering.snapshotEvents(), attemptTarget(attemptSeq))).toBeUndefined()

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
    expect(resolveInterruptedRetryTarget(twoAssistants.snapshotEvents(), messageTarget(second.id))).toBeUndefined()
  })

  it('rejects a tail followed by a later turn', () => {
    const fixture = interruptedFixture()
    fixture.session.append('turn/start', { turn: 2 })
    const later = createUserMessage({ content: [{ type: 'text', text: 'later' }], source: { kind: 'user' } })
    fixture.session.append('user/message', later, { surfaceOp: 'append' })
    expect(resolveInterruptedRetryTarget(fixture.session.snapshotEvents(), fixture.target)).toBeUndefined()

    const attempt = attemptFixture()
    attempt.session.append('turn/start', { turn: 2 })
    const attemptLater = createUserMessage({ content: [{ type: 'text', text: 'later' }], source: { kind: 'user' } })
    attempt.session.append('user/message', attemptLater, { surfaceOp: 'append' })
    expect(resolveInterruptedRetryTarget(attempt.session.snapshotEvents(), attempt.target)).toBeUndefined()
  })

  it('rejects an interrupted message superseded by a later surface node', () => {
    const session = Session.create(SessionId('retry-tail-mismatch'))
    session.append('turn/start', { turn: 1 })
    session.append('step/start', { turn: 1, step: 1 })
    const prompt = createUserMessage({ content: [{ type: 'text', text: 'original prompt' }], source: { kind: 'user' } })
    session.append('user/message', prompt, { surfaceOp: 'append' })
    const assistant = createAssistantMessage({ content: [{ type: 'text', text: 'half' }], source: { provider: 'p', model: 'm' } })
    session.append('assistant/message', {
      turn: 1, step: 1, message: assistant, stream: [], interrupted: true,
    }, { surfaceOp: 'append' })
    session.append('step/end', { turn: 1, step: 1 })
    // A context injection lands after the interrupted answer while the Turn is
    // still open, so the addressed message is no longer the current surface tail.
    const context = createUserMessage({
      content: [{ type: 'text', text: '<runtime context>' }],
      source: { kind: 'plugin', plugin: 'runtime-context' },
    })
    session.append('user/message', context, { surfaceOp: 'append' })
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    expect(resolveInterruptedRetryTarget(session.snapshotEvents(), messageTarget(assistant.id))).toBeUndefined()
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
    request: { sessionId: fixture.session.id, target: fixture.target },
  }
}

describe('SessionCommandController.retryInterrupted', () => {
  it('admits one message replacement replaying the durable prompt', async () => {
    const fixture = interruptedFixture()
    const harness = commandHarness(fixture)
    await expect(harness.controller.retryInterrupted(harness.request)).resolves.toEqual({ accepted: true })
    expect(harness.retryInterrupted).toHaveBeenCalledTimes(1)
    const [message, replacement] = harness.retryInterrupted.mock.calls[0] as [unknown, {
      readonly startSeq: number
      readonly endSeq: number
      readonly sourceEventSeqs: readonly number[]
    }]
    expect(message).toMatchObject({
      content: [{ type: 'text', text: 'original prompt' }],
      source: { kind: 'assistant-retry', retryOf: fixture.target },
    })
    expect(replacement).toEqual({
      startSeq: fixture.promptSeq,
      endSeq: fixture.assistantSeq,
      sourceEventSeqs: [fixture.promptSeq, fixture.assistantSeq],
    })
  })

  it('admits one log-only attempt replacement citing the attempt', async () => {
    const fixture = attemptFixture()
    const harness = commandHarness(fixture)
    await expect(harness.controller.retryInterrupted(harness.request)).resolves.toEqual({ accepted: true })
    expect(harness.retryInterrupted).toHaveBeenCalledTimes(1)
    const [message, replacement] = harness.retryInterrupted.mock.calls[0] as [unknown, {
      readonly startSeq: number
      readonly endSeq: number
      readonly sourceEventSeqs: readonly number[]
    }]
    expect(message).toMatchObject({
      content: [{ type: 'text', text: 'original prompt' }],
      source: { kind: 'assistant-retry', retryOf: fixture.target },
    })
    expect(replacement).toEqual({
      startSeq: fixture.promptSeq,
      endSeq: fixture.promptSeq,
      sourceEventSeqs: [fixture.promptSeq, fixture.assistantSeq],
    })
  })

  it('admits one completed surface-message replacement replaying the durable prompt', async () => {
    const fixture = completedFixture()
    const harness = commandHarness(fixture)
    await expect(harness.controller.retryInterrupted(harness.request)).resolves.toEqual({ accepted: true })
    expect(harness.retryInterrupted).toHaveBeenCalledTimes(1)
    const [message, replacement] = harness.retryInterrupted.mock.calls[0] as [unknown, {
      readonly startSeq: number
      readonly endSeq: number
      readonly sourceEventSeqs: readonly number[]
    }]
    expect(message).toMatchObject({
      content: [{ type: 'text', text: 'original prompt' }],
      source: { kind: 'assistant-retry', retryOf: fixture.target },
    })
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
    await harness.controller.retryInterrupted({
      sessionId: fixture.session.id,
      target: messageTarget('other' as MessageId),
    }).then(
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
