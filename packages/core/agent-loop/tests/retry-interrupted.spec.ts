import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { UserMessage } from '@deepseek-ai/dsh-llm'
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { type Agent, type SurfaceReplacement } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId, SessionSeq } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { MockAdapter, textResponse } from './mock-adapter.ts'

async function harness(adapter: MockAdapter): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentLoop, { agents: [] })
  ctx.llm.registerAdapter(['mock'], adapter)
  return ctx
}

/** Cancel the agent on its first streamed text delta, before the stream completes. */
function cancelOnFirstChunk(ctx: Context, agent: Agent): void {
  let fired = false
  ctx.on('agent/assistant-stream', ({ agent: subject, frame }) => {
    if (fired || subject !== agent || frame.type !== 'chunk') return
    if (frame.chunk.type === 'text-delta') {
      fired = true
      agent.cancel({ kind: 'user' })
    }
  })
}

/** Admit one surface replacement through the live Agent capability. */
function retryInterrupted(agent: Agent, message: UserMessage, replacement: SurfaceReplacement): void {
  if (agent.retryInterrupted === undefined) throw new Error('agent has no retryInterrupted')
  agent.retryInterrupted(message, replacement)
}

/** The last durable interrupted assistant in the log. */
function lastInterruption(agent: Agent): { readonly seq: SessionSeq; readonly id: string } {
  const event = agent.session.snapshotEvents().findLast(candidate =>
    candidate.type === 'assistant/message' && candidate.data.interrupted === true)
  if (event?.type !== 'assistant/message') throw new Error('interruption not recorded')
  return { seq: event.seq, id: event.data.message.id }
}

describe('Agent.retryInterrupted', () => {
  it('replaces the interrupted tail so the prompt enters history once and no partial remains', async () => {
    const adapter = new MockAdapter(['hang', textResponse('regenerated')])
    const ctx = await harness(adapter)
    const agent = await ctx.agentLoop.create(SessionId('retry'), { provider: 'mock', model: 'mock' })

    const original = createUserMessage({ content: [{ type: 'text', text: 'original prompt' }], source: { kind: 'user' } })
    cancelOnFirstChunk(ctx, agent)
    agent.followup(original)
    await agent.whenIdle()

    const prompt = agent.session.snapshotEvents().find(event => event.type === 'user/message')
    if (prompt?.type !== 'user/message') throw new Error('prompt not recorded')
    const interrupted = lastInterruption(agent)

    const replay = createUserMessage({
      content: [{ type: 'text', text: 'original prompt' }],
      source: { kind: 'plugin', plugin: 'test-retry' },
    })
    retryInterrupted(agent, replay, {
      startSeq: prompt.seq,
      endSeq: interrupted.seq,
      sourceEventSeqs: [prompt.seq, interrupted.seq],
    })
    await agent.whenIdle()

    const messages = agent.session.deriveMessages()
    const users = messages.filter(message => message.role === 'user')
    expect(users).toHaveLength(1)
    expect(users[0]?.content).toEqual([{ type: 'text', text: 'original prompt' }])
    const assistantText = messages
      .filter(message => message.role === 'assistant')
      .flatMap(message => message.content)
      .map(block => block.type === 'text' ? block.text : '')
      .join('')
    expect(assistantText).toContain('regenerated')
    expect(assistantText).not.toContain('partial')
    // The durable append-only log keeps the replaced attempt for audit.
    expect(agent.session.snapshotEvents().some(event =>
      event.type === 'assistant/message' && event.data.interrupted === true)).toBe(true)
  })

  it('clears the pending replacement when admission throws', async () => {
    const adapter = new MockAdapter([textResponse('ok')])
    const ctx = await harness(adapter)
    const agent = await ctx.agentLoop.create(SessionId('retry-throw'), { provider: 'mock', model: 'mock' })

    const invalid = createUserMessage({
      content: [{ type: 'text', text: 'x', bad: 1n } as never],
      source: { kind: 'plugin', plugin: 'p' },
    })
    expect(() => {
      retryInterrupted(agent, invalid, { startSeq: SessionSeq(0), endSeq: SessionSeq(0), sourceEventSeqs: [SessionSeq(0)] })
    }).toThrow(/non-JSON-serializable/)

    const prompt = createUserMessage({ content: [{ type: 'text', text: 'later' }], source: { kind: 'user' } })
    agent.followup(prompt)
    await agent.whenIdle()
    const userEvents = agent.session.snapshotEvents().filter(event => event.type === 'user/message')
    expect(userEvents).toHaveLength(1)
    expect(userEvents[0]?.surfaceOp).toBe('append')
  })

  it('drops a pending replacement when the agent is cancelled before admission', async () => {
    const adapter = new MockAdapter([textResponse('ok')])
    const ctx = await harness(adapter)
    const agent = await ctx.agentLoop.create(SessionId('retry-cancel'), { provider: 'mock', model: 'mock' })

    const replay = createUserMessage({ content: [{ type: 'text', text: 'x' }], source: { kind: 'plugin', plugin: 'p' } })
    retryInterrupted(agent, replay, { startSeq: SessionSeq(0), endSeq: SessionSeq(0), sourceEventSeqs: [SessionSeq(0)] })
    agent.cancel({ kind: 'user' }, { keepInbox: true })
    await agent.whenIdle()

    // The pending replacement was cleared, so a later ordinary follow-up appends normally.
    const prompt = createUserMessage({ content: [{ type: 'text', text: 'later' }], source: { kind: 'user' } })
    agent.followup(prompt)
    await agent.whenIdle()
    const userEvents = agent.session.snapshotEvents().filter(event => event.type === 'user/message')
    expect(userEvents.every(event => event.surfaceOp === 'append')).toBe(true)
  })

  it('refuses to overwrite a pending replacement', async () => {
    const adapter = new MockAdapter([textResponse('ok')])
    const ctx = await harness(adapter)
    const agent = await ctx.agentLoop.create(SessionId('retry-pending'), { provider: 'mock', model: 'mock' })

    const first = createUserMessage({ content: [{ type: 'text', text: 'a' }], source: { kind: 'plugin', plugin: 'p' } })
    const second = createUserMessage({ content: [{ type: 'text', text: 'b' }], source: { kind: 'plugin', plugin: 'p' } })
    const replacement: SurfaceReplacement = { startSeq: SessionSeq(0), endSeq: SessionSeq(0), sourceEventSeqs: [SessionSeq(0)] }
    retryInterrupted(agent, first, replacement)
    expect(() => { retryInterrupted(agent, second, replacement) }).toThrow(/already pending/)
    agent.cancel({ kind: 'user' })
    await agent.whenIdle()
  })

  it('clears a pending replacement when the step is rejected', async () => {
    const adapter = new MockAdapter([textResponse('ok')])
    const ctx = await harness(adapter)
    const agent = await ctx.agentLoop.create(SessionId('retry-reject'), { provider: 'mock', model: 'mock' })
    ctx.on('agent/pre-step', async () => ({ kind: 'reject' }))

    const first = createUserMessage({ content: [{ type: 'text', text: 'a' }], source: { kind: 'plugin', plugin: 'p' } })
    const replacement: SurfaceReplacement = { startSeq: SessionSeq(0), endSeq: SessionSeq(0), sourceEventSeqs: [SessionSeq(0)] }
    retryInterrupted(agent, first, replacement)
    await agent.whenIdle()

    const second = createUserMessage({ content: [{ type: 'text', text: 'b' }], source: { kind: 'plugin', plugin: 'p' } })
    expect(() => { retryInterrupted(agent, second, replacement) }).not.toThrow(/already pending/)
    agent.cancel({ kind: 'user' })
    await agent.whenIdle()
  })

  it('retries again after the retry itself is interrupted', async () => {
    const adapter = new MockAdapter(['hang', 'hang', textResponse('third answer')])
    const ctx = await harness(adapter)
    const agent = await ctx.agentLoop.create(SessionId('retry-twice'), { provider: 'mock', model: 'mock' })

    const original = createUserMessage({ content: [{ type: 'text', text: 'original prompt' }], source: { kind: 'user' } })
    cancelOnFirstChunk(ctx, agent)
    agent.followup(original)
    await agent.whenIdle()

    const first = lastInterruption(agent)
    const prompt = agent.session.snapshotEvents().find(event => event.type === 'user/message')
    if (prompt?.type !== 'user/message') throw new Error('prompt not recorded')

    const replay1 = createUserMessage({ content: [{ type: 'text', text: 'original prompt' }], source: { kind: 'plugin', plugin: 'test-retry' } })
    cancelOnFirstChunk(ctx, agent)
    retryInterrupted(agent, replay1, { startSeq: prompt.seq, endSeq: first.seq, sourceEventSeqs: [prompt.seq, first.seq] })
    await agent.whenIdle()

    const second = lastInterruption(agent)
    const replayEvent = agent.session.snapshotEvents().findLast(event =>
      event.type === 'user/message' && event.data.id === replay1.id)
    if (replayEvent?.type !== 'user/message') throw new Error('replay not recorded')

    const replay2 = createUserMessage({ content: [{ type: 'text', text: 'original prompt' }], source: { kind: 'plugin', plugin: 'test-retry' } })
    retryInterrupted(agent, replay2, {
      startSeq: replayEvent.seq,
      endSeq: second.seq,
      sourceEventSeqs: [replayEvent.seq, second.seq],
    })
    await agent.whenIdle()

    const messages = agent.session.deriveMessages()
    expect(messages.filter(message => message.role === 'user')).toHaveLength(1)
    const assistantText = messages
      .filter(message => message.role === 'assistant')
      .flatMap(message => message.content)
      .map(block => block.type === 'text' ? block.text : '')
      .join('')
    expect(assistantText).toContain('third answer')
    expect(assistantText).not.toContain('partial')
  })
})
