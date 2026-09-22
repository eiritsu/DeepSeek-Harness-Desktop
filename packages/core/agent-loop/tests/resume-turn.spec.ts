import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { UserMessage } from '@deepseek-ai/dsh-llm'
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
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

function prompt(text: string): UserMessage {
  return createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } })
}

/** Resume one stopped Turn through the live Agent capability. */
function resumeTurn(agent: Agent): void {
  if (agent.resumeTurn === undefined) throw new Error('agent has no resumeTurn')
  agent.resumeTurn()
}

describe('Agent.resumeTurn', () => {
  it('spends one model request over the stopped turn surface without admitting a user message', async () => {
    const adapter = new MockAdapter(['hang', textResponse('continued')])
    const ctx = await harness(adapter)
    const agent = await ctx.agentLoop.create(SessionId('resume'), { provider: 'mock', model: 'mock' })
    cancelOnFirstChunk(ctx, agent)
    agent.followup(prompt('original prompt'))
    await agent.whenIdle()

    resumeTurn(agent)
    await agent.whenIdle()

    const events = agent.session.snapshotEvents()
    expect(events.filter(event => event.type === 'turn/start')).toHaveLength(2)
    expect(events.filter(event => event.type === 'user/message')).toHaveLength(1)
    // The resumed request derives from the current surface: the stopped
    // Turn's partial answer stays in history and no earlier request is
    // replayed, so committed tool results would stay in it too.
    const resumed = adapter.requests.at(-1)
    expect(resumed?.messages.at(-1)?.role).toBe('assistant')
    expect(resumed?.messages.filter(message => message.role === 'user')).toHaveLength(1)
    const assistantText = agent.session.deriveMessages()
      .filter(message => message.role === 'assistant')
      .flatMap(message => message.content)
      .map(block => block.type === 'text' ? block.text : '')
      .join('')
    expect(assistantText).toContain('continued')
  })

  it('refuses to resume while the driver is running', async () => {
    const adapter = new MockAdapter(['hang'])
    const ctx = await harness(adapter)
    const agent = await ctx.agentLoop.create(SessionId('resume-running'), { provider: 'mock', model: 'mock' })
    agent.followup(prompt('original prompt'))
    await vi.waitFor(() => { expect(adapter.requests).toHaveLength(1) })
    expect(() => { resumeTurn(agent) }).toThrow(/idle/)
    agent.cancel({ kind: 'user' })
    await agent.whenIdle()
  })
})
