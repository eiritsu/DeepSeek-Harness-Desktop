/**
 * The shadowing follow-up: `Agent.followup(message, replacement)` admits its
 * message in place of an earlier surface range instead of appending to it, so a
 * resend rewrites what the model sees without rewriting the log.
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime, { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { ContentBlock, Message } from '@deepseek-ai/dsh-llm'
import SessionStore, { Session, SessionId } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import AgentRegistry, { type Agent } from '@deepseek-ai/dsh-agent'
import type { SurfaceReplacement } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
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

function waitForIdle(ctx: Context, agent: Agent): Promise<void> {
  return new Promise((resolve) => {
    const dispose = ctx.on('agent/status', ({ agent: subject, status }) => {
      if (subject === agent && status === 'idle') {
        dispose()
        resolve()
      }
    })
  })
}

function prompt(agent: Agent, text: string, replacement?: SurfaceReplacement): void {
  const message = createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } })
  agent.followup(message, replacement)
}

function textOf(message: { content: readonly ContentBlock[] }): string {
  return message.content.map(block => block.type === 'text' ? block.text : '').join('')
}

/** Model-visible conversation text, without the reconciled system prompt. */
function conversation(agent: Agent): string[] {
  return withoutSystem(agent.session.deriveMessages())
}

function withoutSystem(messages: readonly Message[]): string[] {
  return messages
    .filter((message): message is Message & { role: 'user' | 'assistant' } => message.role !== 'system')
    .map(textOf)
}

/** The surface span one completed ordinary turn occupies, shadowing both of its messages. */
function lastTurnRange(session: Session): SurfaceReplacement {
  const nodes = session.surface.nodes
  const start = nodes[nodes.length - 2]
  const end = nodes.at(-1)
  if (start === undefined || end === undefined) throw new Error('the session has no completed turn to replace')
  return { startSeq: start, endSeq: end, sourceEventSeqs: nodes.slice(nodes.indexOf(start)) }
}

function only<T extends SessionEvent['type']>(events: readonly SessionEvent[], type: T): SessionEvent<T> {
  const found = events.filter(event => event.type === type)
  if (found.length !== 1) throw new Error(`expected exactly one ${type} event, found ${String(found.length)}`)
  return found[0]! as SessionEvent<T>
}

describe('followup with a surface replacement', () => {
  it('admits the message in place of the range and keeps both log records', async () => {
    const adapter = new MockAdapter([textResponse('first answer'), textResponse('second answer')])
    const ctx = await harness(adapter)
    const agent = await ctx.agentLoop.create(SessionId('resend'), { provider: 'mock', model: 'mock' })

    prompt(agent, 'first question')
    await waitForIdle(ctx, agent)
    const afterFirst = agent.session.snapshotEvents()
    const original = afterFirst.find(event => event.type === 'user/message')!
    const answer = afterFirst.find(event => event.type === 'assistant/message')!

    const replacement = lastTurnRange(agent.session)
    prompt(agent, 'second question', replacement)
    await waitForIdle(ctx, agent)

    const afterSecond = agent.session.snapshotEvents()
    const admitted = only(afterSecond.slice(answer.seq + 1), 'user/message')
    expect(admitted).toMatchObject({
      surfaceOp: { op: 'replace', startSeq: replacement.startSeq, endSeq: replacement.endSeq },
      sourceEventSeqs: [...replacement.sourceEventSeqs],
    })

    // The shadowed records stay in the log at their original sequences, and the
    // append-only prefix a reader already saw is byte-identical.
    expect(afterSecond[original.seq]).toEqual(original)
    expect(afterSecond[answer.seq]).toEqual(answer)
    expect(afterSecond.slice(0, afterFirst.length)).toEqual(afterFirst)
    expect(afterSecond.filter(event => event.type === 'user/message').map(event => textOf(event.data)))
      .toEqual(['first question', 'second question'])
  })

  it('makes the edited prompt the model-visible history in place of the old turn', async () => {
    const adapter = new MockAdapter([textResponse('first answer'), textResponse('second answer')])
    const ctx = await harness(adapter)
    const agent = await ctx.agentLoop.create(SessionId('resend-visible'), { provider: 'mock', model: 'mock' })

    prompt(agent, 'first question')
    await waitForIdle(ctx, agent)
    const replacement = lastTurnRange(agent.session)
    prompt(agent, 'second question', replacement)
    await waitForIdle(ctx, agent)

    expect(conversation(agent)).toEqual(['second question', 'second answer'])
    expect(adapter.requests).toHaveLength(2)
    expect(withoutSystem(adapter.requests[1]?.messages as Message[] ?? [])).toEqual(['second question'])

    // The shadowed seqs left the surface; the replacement took their place.
    const nodes = agent.session.surface.nodes
    const admitted = agent.session.snapshotEvents().find(
      event => event.type === 'user/message' && event.seq === nodes.at(-2),
    )
    expect(admitted).toBeDefined()
    expect(textOf((admitted as SessionEvent<'user/message'>).data)).toBe('second question')
    expect(nodes).toHaveLength(3)
    expect(nodes.at(-1)).toBe(agent.session.snapshotEvents().findLast(event => event.type === 'assistant/message')?.seq)
  })

  it('starts a distinct request series for the replacement', async () => {
    const adapter = new MockAdapter([textResponse('first answer'), textResponse('second answer')])
    const ctx = await harness(adapter)
    const agent = await ctx.agentLoop.create(SessionId('resend-series'), { provider: 'mock', model: 'mock' })

    prompt(agent, 'first question')
    await waitForIdle(ctx, agent)
    const generation = agent.session.surface.contentGeneration
    const replaceGeneration = agent.session.surface.replaceGeneration

    prompt(agent, 'second question', lastTurnRange(agent.session))
    await waitForIdle(ctx, agent)

    expect(agent.session.surface.contentGeneration).toBeGreaterThan(generation)
    expect(agent.session.surface.replaceGeneration).toBe(replaceGeneration + 1)
  })

  it('fails the admission of a range whose nodes are no longer on the surface', async () => {
    const adapter = new MockAdapter([
      textResponse('first answer'), textResponse('second answer'), textResponse('third answer'),
    ])
    const ctx = await harness(adapter)
    const agent = await ctx.agentLoop.create(SessionId('resend-stale'), { provider: 'mock', model: 'mock' })

    prompt(agent, 'first question')
    await waitForIdle(ctx, agent)
    const first = lastTurnRange(agent.session)

    prompt(agent, 'second question', first)
    await waitForIdle(ctx, agent)
    const afterResend = agent.session.snapshotEvents()
    const replaceGeneration = agent.session.surface.replaceGeneration

    // The first turn's nodes are now shadowed, so naming them again is stale.
    // Admission fails loudly: no node is rewritten and the turn reports the error.
    const errors: string[] = []
    ctx.on('agent/error', ({ error }) => void errors.push(error instanceof Error ? error.message : String(error)))
    prompt(agent, 'stale replacement', first)
    await agent.whenIdle()

    expect(agent.session.surface.replaceGeneration).toBe(replaceGeneration)
    expect(agent.session.snapshotEvents().slice(0, afterResend.length)).toEqual(afterResend)
    expect(errors.join('\n')).toMatch(/surface/i)
    expect(agent.session.snapshotEvents().at(-1)).toMatchObject({
      type: 'turn/end', data: { reason: { kind: 'error' } },
    })
  })
})
