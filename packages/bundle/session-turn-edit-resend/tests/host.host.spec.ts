/**
 * Host edit-and-resend admission: which turns may be replaced, what the log
 * records about an attempt, and the two orderings the attempt depends on — the
 * durable record before the model request, and one attempt per operation
 * identity.
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { createUserMessage, LlmRuntime } from '@deepseek-ai/dsh-llm'
import type { ContentBlock, Message } from '@deepseek-ai/dsh-llm'
import SessionStore, { Session, SessionId } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineContentToolFixture } from '@deepseek-ai/dsh-tools'
import SessionTurnEditResend from '../src/index.ts'
import type { ResendOperationId } from '../src/types.ts'
import { findResendOperation, readResendJournal } from '../src/journal.ts'
import { editPromptContent, selectResendTarget } from '../src/policy.ts'
import { HANG, MockAdapter, SILENT_HANG, textResponse, toolCallResponse } from './mock-adapter.ts'

const NEVER_ABORTED = new AbortController().signal

async function harness(script: ConstructorParameters<typeof MockAdapter>[0]): Promise<{
  ctx: Context
  agent: Agent
  adapter: MockAdapter
}> {
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(SessionTurnEditResend)
  const adapter = new MockAdapter(script)
  ctx.llm.registerAdapter(['mock'], adapter)
  const agent = await ctx.agentLoop.create(SessionId('resend-host'), { provider: 'mock', model: 'mock' })
  return { ctx, agent, adapter }
}

function prompt(agent: Agent, text: string): void {
  agent.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }))
}

function settle(agent: Agent): Promise<void> {
  return agent.whenIdle()
}

function operation(id: string, text: string): { operationId: ResendOperationId; text: string } {
  return { operationId: id as ResendOperationId, text }
}

function textOf(message: { content: readonly ContentBlock[] }): string {
  return message.content.map(block => block.type === 'text' ? block.text : '').join('')
}

/** Model-visible conversation, without the reconciled system prompt. */
function conversation(agent: Agent): string[] {
  return agent.session.deriveMessages()
    .filter((message): message is Message & { role: 'user' | 'assistant' } => message.role !== 'system')
    .map(textOf)
}

/** Turn every recorded operation of the session into a comparable entry. */
function journalOf(agent: Agent): readonly unknown[] {
  return readResendJournal(agent.session)
}

describe('edit and resend eligibility', () => {
  it('offers the latest completed turn and seeds its text', async () => {
    const { ctx, agent } = await harness([textResponse('first answer')])
    prompt(agent, 'first question')
    await settle(agent)

    expect(ctx.turnResend.check(agent)).toEqual({
      eligible: true,
      text: 'first question',
      turn: 1,
      startSeq: agent.session.snapshotEvents().find(event => event.type === 'user/message')!.seq,
      toolCalls: [],
    })
  })

  it('offers the latest turn the user cancelled and replaces its partial answer', async () => {
    const { ctx, agent, adapter } = await harness([HANG, textResponse('resent answer')])
    // Cancel once the partial answer is in flight, so the turn records an
    // interrupted assistant message the resend must shadow.
    ctx.on('agent/assistant-stream', ({ agent: subject, frame }) => {
      if (subject !== agent || frame.type !== 'chunk' || frame.chunk.type !== 'text-delta') return
      agent.cancel({ kind: 'user' })
    })
    prompt(agent, 'stopped question')
    await settle(agent)

    // The cancelled turn is settled history: its partial answer is on the
    // surface, so an edit replaces the turn instead of appending beside it.
    expect(ctx.turnResend.check(agent)).toMatchObject({ eligible: true, text: 'stopped question', turn: 1 })

    const submission = await ctx.turnResend.submit(agent, operation('op-stopped', 'edited stopped question'), NEVER_ABORTED)
    await settle(agent)

    expect(submission).toMatchObject({ recorded: true, operation: { outcome: 'admitted' } })
    expect(conversation(agent)).toEqual(['edited stopped question', 'resent answer'])
    expect(adapter.requests).toHaveLength(2)
  })

  it('offers a cancelled turn that produced no answer and resends its prompt', async () => {
    const { ctx, agent, adapter } = await harness([SILENT_HANG, textResponse('resent answer')])
    const promptAdmitted = new Promise<void>((resolve) => {
      const dispose = ctx.on('session/event', (_session, event) => {
        if (event.type !== 'user/message') return
        dispose()
        resolve()
      })
    })
    prompt(agent, 'stopped question')
    await promptAdmitted
    agent.cancel({ kind: 'user' })
    await settle(agent)
    expect(agent.session.snapshotEvents().some(event => event.type === 'assistant/message')).toBe(false)

    // The cancelled turn has no answer to shadow, so its range is the prompt
    // alone; resending it simply asks again.
    expect(ctx.turnResend.check(agent)).toMatchObject({ eligible: true, text: 'stopped question', turn: 1 })

    const submission = await ctx.turnResend.submit(agent, operation('op-empty-output', 'edited stopped question'), NEVER_ABORTED)
    await settle(agent)

    expect(submission).toMatchObject({ recorded: true, operation: { outcome: 'admitted' } })
    expect(conversation(agent)).toEqual(['edited stopped question', 'resent answer'])
    expect(adapter.requests).toHaveLength(2)
  })

  it('keeps a tool turn editable, discloses its tools, and shadows its calls on resend', async () => {
    const { ctx, agent, adapter } = await harness([
      toolCallResponse('call-1', 'echo', { text: 'side effect' }),
      textResponse('after the tool'),
      textResponse('after the resend'),
    ])
    let executions = 0
    ctx.tools.register(defineContentToolFixture({
      name: 'echo',
      description: 'Record one side effect outside the harness.',
      parameters: { text: { type: 'string', required: true } },
      execute() {
        executions += 1
        return Promise.resolve([{ type: 'text', text: 'recorded' }])
      },
    }))
    prompt(agent, 'write to the world')
    await settle(agent)
    const before = agent.session.snapshotEvents()

    // The turn ran a tool and still completed, so it is the latest turn. It
    // stays editable, and `check` discloses the tool so the consumer can warn
    // that the resend may repeat the side effect.
    expect(executions).toBe(1)
    expect(ctx.turnResend.check(agent)).toEqual({
      eligible: true,
      text: 'write to the world',
      turn: 1,
      startSeq: before.find(event => event.type === 'user/message')!.seq,
      toolCalls: ['echo'],
    })

    await ctx.turnResend.submit(agent, operation('op-tool', 'edited world'), NEVER_ABORTED)
    await settle(agent)

    // The replacement shadows the tool call, its result, and the old answer in
    // the model-visible surface; the append-only log keeps every record.
    expect(agent.session.snapshotEvents().slice(0, before.length)).toEqual(before)
    expect(conversation(agent)).toEqual(['edited world', 'after the resend'])
    expect(agent.session.snapshotEvents().some(event => event.type === 'tool/call')).toBe(true)
    expect(agent.session.surface.nodes).not.toContain(
      before.find(event => event.type === 'tool/result')!.seq,
    )
    // Two requests built the original tool turn; the resend is the third.
    expect(adapter.requests).toHaveLength(3)
  })

  it('refuses while the agent is running or the inbox holds input', async () => {
    const { ctx, agent, adapter } = await harness([HANG, textResponse('queued answer')])
    const requested = adapter.whenRequested()
    prompt(agent, 'long question')
    // The driver commits its running phase synchronously with the prompt.
    expect(agent.status).toBe('running')
    await requested

    expect(ctx.turnResend.check(agent)).toEqual({ eligible: false, refusal: 'agent-busy' })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'queued' }], source: { kind: 'user' } }))
    expect(agent.inbox.nextTurn).toHaveLength(1)
    expect(ctx.turnResend.check(agent)).toEqual({ eligible: false, refusal: 'agent-busy' })
    agent.cancel({ kind: 'user' })
    await settle(agent)
    expect(adapter.requests).toHaveLength(1)

    // An idle agent with pending injected input is not editable either.
    agent.inject(createUserMessage({ content: [{ type: 'text', text: 'injected' }], source: { kind: 'test' } }))
    expect(agent.status).toBe('idle')
    expect(ctx.turnResend.check(agent)).toEqual({ eligible: false, refusal: 'inbox-pending' })
  })

  it('refuses a session with no replaceable turn and records nothing', async () => {
    const { ctx, agent, adapter } = await harness([textResponse('unused')])
    const submission = await ctx.turnResend.submit(agent, operation('op-empty', 'edited'), NEVER_ABORTED)

    expect(submission).toEqual({ recorded: false, refusal: 'no-replaceable-turn' })
    expect(journalOf(agent)).toEqual([])
    expect(adapter.requests).toEqual([])
  })

  it('refuses a turn the environment failed', async () => {
    const { ctx, agent } = await harness([])
    prompt(agent, 'doomed question')
    await settle(agent)

    // The exhausted script fails the model call, so the turn ends in error.
    expect(agent.session.snapshotEvents().some(event => event.type === 'turn/end' && event.data.reason.kind === 'error')).toBe(true)
    expect(ctx.turnResend.check(agent)).toEqual({ eligible: false, refusal: 'no-replaceable-turn' })
  })

  it('refuses a settled turn once a later turn owns the surface', async () => {
    const { ctx, agent } = await harness([textResponse('first answer'), HANG])
    prompt(agent, 'first question')
    await settle(agent)
    const secondStarted = new Promise<void>((resolve) => {
      const dispose = ctx.on('session/event', (_session, event) => {
        if (event.type !== 'turn/start' || event.data.turn !== 2) return
        dispose()
        resolve()
      })
    })
    prompt(agent, 'second question')
    await secondStarted

    expect(selectResendTarget(agent.session)).toEqual({ eligible: false, refusal: 'not-latest-turn' })
    agent.cancel({ kind: 'user' })
    await settle(agent)
  })
})

describe('admission', () => {
  it('replaces the turn in the log and makes the edit the model-visible history', async () => {
    const { ctx, agent, adapter } = await harness([textResponse('first answer'), textResponse('second answer')])
    prompt(agent, 'first question')
    await settle(agent)
    const beforeResend = agent.session.snapshotEvents()

    const submission = await ctx.turnResend.submit(agent, operation('op-1', 'edited question'), NEVER_ABORTED)
    await settle(agent)

    expect(submission).toMatchObject({ recorded: true, operation: { outcome: 'admitted' } })
    // The log keeps every earlier record at its original sequence.
    expect(agent.session.snapshotEvents().slice(0, beforeResend.length)).toEqual(beforeResend)
    expect(conversation(agent)).toEqual(['edited question', 'second answer'])
    expect(adapter.requests).toHaveLength(2)
    expect(journalOf(agent)).toEqual([{
      ...submission.recorded === true ? submission.operation : {},
      outcome: 'admitted',
    }])
  })

  it('records requested and request-started before the model request is issued', async () => {
    const { ctx, agent, adapter } = await harness([textResponse('first answer'), textResponse('second answer')])
    prompt(agent, 'first question')
    await settle(agent)

    const durableAt: number[] = []
    ctx.on('session/event', (session, event) => {
      if (event.type === 'turn-resend/request-started') {
        durableAt.push(session.snapshotEvents().filter(seen => seen.type === 'turn-resend/requested').length)
      }
    })
    let requestsWhenStarted = -1
    ctx.on('agent/pre-step', (_payload, next) => {
      if (requestsWhenStarted < 0) requestsWhenStarted = adapter.requests.length
      return next()
    })

    await ctx.turnResend.submit(agent, operation('op-2', 'edited question'), NEVER_ABORTED)
    await settle(agent)

    // The request record is already in the log when the driver reaches the step
    // that issues the model call, so the two can never be reordered.
    expect(durableAt).toEqual([1])
    expect(requestsWhenStarted).toBe(1)
    expect(adapter.requests).toHaveLength(2)
  })

  it('holds the model request until the durable record has been flushed', async () => {
    const { ctx, agent, adapter } = await harness([textResponse('first answer'), textResponse('second answer')])
    prompt(agent, 'first question')
    await settle(agent)

    const gate = Promise.withResolvers<undefined>()
    const entered = Promise.withResolvers<undefined>()
    let flushes = 0
    ctx.on('session/flush', async () => {
      flushes += 1
      entered.resolve(undefined)
      await gate.promise
    })

    const submitted = ctx.turnResend.submit(agent, operation('op-barrier', 'edited question'), NEVER_ABORTED)
    await entered.promise

    // The record is committed and the message is queued, but nothing has reached
    // the model: the driver's wake happens after the flush resolves.
    expect(flushes).toBe(1)
    expect(adapter.requests).toHaveLength(1)
    expect(agent.inbox.nextTurn).toHaveLength(1)

    gate.resolve(undefined)
    expect((await submitted).recorded).toBe(true)
    await settle(agent)
    expect(adapter.requests).toHaveLength(2)
  })

  it('refuses a second submission while the first holds the claim', async () => {
    const { ctx, agent, adapter } = await harness([textResponse('first answer'), textResponse('second answer')])
    prompt(agent, 'first question')
    await settle(agent)

    const gate = Promise.withResolvers<undefined>()
    ctx.on('session/flush', async () => { await gate.promise })

    const first = ctx.turnResend.submit(agent, operation('op-a', 'edited question'), NEVER_ABORTED)
    const second = await ctx.turnResend.submit(agent, operation('op-b', 'other question'), NEVER_ABORTED)
    gate.resolve(undefined)
    await first
    await settle(agent)

    // The second request lost the idle claim. It is refused and recorded, and it
    // never produced a model call of its own. The first submission's queued
    // message is pending, so the second caller sees the inbox as occupied.
    expect(second).toMatchObject({
      recorded: true,
      operation: { operationId: 'op-b', outcome: 'refused', refusal: 'inbox-pending' },
    })
    expect(adapter.requests).toHaveLength(2)
    expect(conversation(agent)).toEqual(['edited question', 'second answer'])
  })

  it('aborts before the durable commit when the caller cancels', async () => {
    const { ctx, agent, adapter } = await harness([textResponse('first answer'), textResponse('second answer')])
    prompt(agent, 'first question')
    await settle(agent)

    const controller = new AbortController()
    controller.abort()
    const submission = await ctx.turnResend.submit(agent, operation('op-abort', 'edited'), controller.signal)
    await settle(agent)

    expect(submission).toMatchObject({ recorded: true, operation: { outcome: 'refused', refusal: 'aborted' } })
    expect(adapter.requests).toHaveLength(1)
    expect(conversation(agent)).toEqual(['first question', 'first answer'])
  })
})

describe('operation identity', () => {
  it('answers a repeated submission from the journal without a second model call', async () => {
    const { ctx, agent, adapter } = await harness([textResponse('first answer'), textResponse('second answer')])
    prompt(agent, 'first question')
    await settle(agent)

    const first = await ctx.turnResend.submit(agent, operation('op-same', 'edited question'), NEVER_ABORTED)
    await settle(agent)
    const repeated = await ctx.turnResend.submit(agent, operation('op-same', 'a different edit'), NEVER_ABORTED)
    await settle(agent)

    expect(repeated).toEqual(first)
    expect(adapter.requests).toHaveLength(2)
    expect(conversation(agent)).toEqual(['edited question', 'second answer'])
    expect(journalOf(agent)).toHaveLength(1)
  })

  it('leaves an interrupted operation uncertain and never repeats it', async () => {
    const { ctx, agent, adapter } = await harness([textResponse('first answer'), HANG])
    prompt(agent, 'first question')
    await settle(agent)

    // Simulate a process that stopped after the request was durable but before
    // the log could record how it ended: the message is queued, nothing admits
    // it, and the journal reads the honest answer.
    const gate = Promise.withResolvers<undefined>()
    const entered = Promise.withResolvers<undefined>()
    ctx.on('session/flush', async () => {
      entered.resolve(undefined)
      await gate.promise
    })
    const submitted = ctx.turnResend.submit(agent, operation('op-crash', 'edited question'), NEVER_ABORTED)
    await entered.promise
    gate.resolve(undefined)
    await submitted

    // The resumed process reads the same log and must not drive the call again.
    agent.cancel({ kind: 'user' })
    agent.inbox.clear()
    await settle(agent)
    const repeated = await ctx.turnResend.submit(agent, operation('op-crash', 'edited question'), NEVER_ABORTED)
    await settle(agent)

    expect(repeated).toMatchObject({
      recorded: true,
      operation: { operationId: 'op-crash', outcome: 'uncertain' },
    })
    expect(journalOf(agent)).toHaveLength(1)
    expect(conversation(agent)).toEqual(['first question', 'first answer'])
    expect(adapter.requests).toHaveLength(1)
  })

  it('reads a log written before these events existed as an empty journal', async () => {
    const { ctx, agent } = await harness([textResponse('first answer')])
    prompt(agent, 'first question')
    await settle(agent)
    const before = agent.session.snapshotEvents()

    // A session restored from storage replays only its own events; the fold
    // must not require any resend event to be present.
    expect(journalOf(agent)).toEqual([])
    expect(agent.session.snapshotEvents().slice(0, before.length)).toEqual(before)
    expect(ctx.turnResend.check(agent)).toMatchObject({ eligible: true })
  })
})

describe('edited content preservation', () => {
  it('replaces only the first text block and keeps attachments and later blocks', () => {
    const prompt = createUserMessage({
      content: [
        { type: 'text', text: 'look at this' },
        {
          type: 'image',
          attachment: {
            attachmentId: 'img-1' as never, mediaType: 'image/png', bytes: 3, width: 1, height: 1,
          },
        },
        { type: 'file', attachment: { attachmentId: 'file-1' as never, name: 'a.txt', bytes: 1 } },
        { type: 'text', text: 'derived by a plugin' },
      ],
      source: { kind: 'user' },
    })

    // The replacement reuses every non-text block as its durable reference, so
    // an attachment is never re-parsed or re-stored by an edit.
    expect(editPromptContent(prompt, 'edited text')).toEqual([
      { type: 'text', text: 'edited text' },
      prompt.content[1],
      prompt.content[2],
      prompt.content[3],
    ])
  })
})

describe('target selection', () => {
  it('replaces from the human prompt and never shadows the reserved system head', async () => {
    const { agent } = await harness([textResponse('first answer')])
    prompt(agent, 'first question')
    await settle(agent)

    const events = agent.session.snapshotEvents()
    const systemSeq = events.find(event => event.type === 'system/message')!.seq
    const promptSeq = events.find(event => event.type === 'user/message')!.seq
    const answerSeq = events.find(event => event.type === 'assistant/message')!.seq

    const selection = selectResendTarget(agent.session)
    expect(selection.eligible).toBe(true)
    if (!selection.eligible) throw new Error('unreachable')
    expect(selection.target.replacement).toEqual({
      startSeq: promptSeq,
      endSeq: answerSeq,
      sourceEventSeqs: [promptSeq, answerSeq],
    })
    expect(selection.target.replacement.startSeq).not.toBe(systemSeq)
  })

  it('refuses a turn the driver still owns', async () => {
    const { ctx, agent } = await harness([HANG, textResponse('queued answer')])
    const turnStarted = new Promise<void>((resolve) => {
      const dispose = ctx.on('session/event', (_session, event) => {
        if (event.type !== 'turn/start') return
        dispose()
        resolve()
      })
    })
    prompt(agent, 'long question')
    await turnStarted

    expect(selectResendTarget(agent.session)).toEqual({ eligible: false, refusal: 'no-replaceable-turn' })
    agent.cancel({ kind: 'user' })
    await settle(agent)
  })
})

describe('journal across restart', () => {
  it('folds an admitted operation from a replayed log and answers the repeat from it', async () => {
    const { ctx, agent, adapter } = await harness([textResponse('first answer'), textResponse('second answer')])
    prompt(agent, 'first question')
    await settle(agent)
    await ctx.turnResend.submit(agent, operation('op-restart', 'edited question'), NEVER_ABORTED)
    await settle(agent)

    // A resumed Host reads the operation from the replayed log rather than its
    // predecessor's memory; `admitted` is proved by the surface replacement, so
    // the identity is never sent to the model twice.
    const restored = Session.create(SessionId('resend-host-restart'), agent.session.snapshotEvents())
    expect(readResendJournal(restored)).toMatchObject([
      { operationId: 'op-restart', outcome: 'admitted' },
    ])
    expect(findResendOperation(readResendJournal(restored), 'op-restart' as ResendOperationId)?.outcome)
      .toBe('admitted')
    expect(adapter.requests).toHaveLength(2)
  })

  it('reads a request that never admitted as uncertain after a replay', async () => {
    const { agent } = await harness([textResponse('first answer')])
    prompt(agent, 'first question')
    await settle(agent)

    // Simulate a process that stopped after the request was durable but before
    // the model reached the admission: only the two operation events exist, so
    // the resumed Host must report the honest uncertainty instead of retrying.
    const selection = selectResendTarget(agent.session)
    if (!selection.eligible) throw new Error('unreachable')
    const { turn, replacement } = selection.target
    agent.session.append('turn-resend/requested', {
      operationId: 'op-uncertain', turn, startSeq: replacement.startSeq, endSeq: replacement.endSeq,
    })
    agent.session.append('turn-resend/request-started', {
      operationId: 'op-uncertain',
      messageId: 'msg-uncertain' as never,
      turn,
      startSeq: replacement.startSeq,
      endSeq: replacement.endSeq,
    })

    const restored = Session.create(SessionId('resend-host-uncertain'), agent.session.snapshotEvents())
    expect(readResendJournal(restored)).toMatchObject([
      { operationId: 'op-uncertain', outcome: 'uncertain' },
    ])
  })
})

describe('durable commit order', () => {
  it('records the message identity before the queue can execute it, and every crash prefix is honest', async () => {
    const { ctx, agent, adapter } = await harness([textResponse('first answer'), textResponse('second answer')])
    prompt(agent, 'first question')
    await settle(agent)

    // Capture the log prefix after each durable commit of one attempt.
    const prefixes: Array<{ type: string; events: readonly SessionEvent[] }> = []
    ctx.on('session/event', (session, event) => {
      const isOperationCommit = event.type === 'turn-resend/requested'
        || event.type === 'turn-resend/request-started'
        || (event.type === 'user/message' && event.surfaceOp !== 'append')
      if (!isOperationCommit) return
      prefixes.push({ type: event.type, events: session.snapshotEvents().slice() })
    })

    await ctx.turnResend.submit(agent, operation('op-order', 'edited question'), NEVER_ABORTED)
    await settle(agent)

    expect(prefixes.map(prefix => prefix.type)).toEqual([
      'turn-resend/requested', 'turn-resend/request-started', 'user/message',
    ])

    // A crash after `request-started` leaves the message unqueued: the identity
    // is durable, but nothing can execute it, so no model call can be lost.
    const started = prefixes[1]!
    const startedEvent = started.events.find(
      event => event.type === 'turn-resend/request-started',
    ) as SessionEvent<'turn-resend/request-started'>
    expect(started.events.some(event => event.type === 'agent/inbox/spliced'
      && event.data.inserted.some(message => message.id === startedEvent.data.messageId))).toBe(false)

    // Each prefix reports exactly what the log proves.
    expect(readResendJournal(Session.create(SessionId('order-requested'), prefixes[0]!.events)))
      .toMatchObject([{ operationId: 'op-order', outcome: 'pending' }])
    expect(readResendJournal(Session.create(SessionId('order-started'), started.events)))
      .toMatchObject([{ operationId: 'op-order', outcome: 'uncertain' }])
    expect(readResendJournal(Session.create(SessionId('order-admitted'), prefixes[2]!.events)))
      .toMatchObject([{ operationId: 'op-order', outcome: 'admitted' }])
    expect(adapter.requests).toHaveLength(2)
  })
})
