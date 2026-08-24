/** Permanent Session deletion: live ownership, running refusal, and lineage order. */

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import type { Agent, AgentHandle, CreateAgentOptions } from '@deepseek-ai/dsh-agent'
import SessionStore, { SESSION_FORMAT_VERSION, SessionId } from '@deepseek-ai/dsh-session'
import type { SessionEvent, SessionHeader } from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import UserQuestionService from '@deepseek-ai/dsh-user-questions'
import { createApiProxy } from '@deepseek-ai/dsh-host-apiproxy'
import type { RpcRequest } from '@deepseek-ai/dsh-host-apiproxy/api/rpc'
import { RpcId } from '@deepseek-ai/dsh-host-apiproxy/api/rpc'

const contexts: Context[] = []
const roots: string[] = []
let nextRpc = 1

function request<P>(payload: P): RpcRequest<P> {
  return { rpcId: RpcId(`delete-${String(nextRpc++)}`), payload }
}

function header(id: string, parentSession?: string): SessionHeader {
  return {
    version: SESSION_FORMAT_VERSION,
    id: SessionId(id),
    createdAt: 1,
    cwd: '/tmp',
    ...parentSession === undefined ? {} : { parentSession: SessionId(parentSession) },
  }
}

const log: SessionEvent[] = [
  { type: 'turn/start', seq: 0, time: 1, data: { turn: 1 } },
  { type: 'turn/end', seq: 1, time: 2, data: { turn: 1, reason: { kind: 'completed' } } },
]

async function composed(): Promise<Context> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-apiproxy-delete-'))
  roots.push(root)
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(SessionStore)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(UserQuestionService)
  await ctx.plugin(JsonlSessionPersistence, { root, compression: 'none' })
  ctx.agents.setFactory({
    createAgent: async (ownerCtx: Context, options: CreateAgentOptions): Promise<AgentHandle> => {
      let agent!: Agent
      const fiber = await ownerCtx.plugin(Object.assign(async (inner: Context) => {
        const sessions = inner.get('sessions')
        const agents = inner.get('agents')
        if (sessions === undefined || agents === undefined) throw new Error('agent test services are absent')
        const session = sessions.create(options.sessionId, {
          ...options.seed === undefined ? {} : { seed: options.seed },
          ...options.meta === undefined ? {} : { meta: options.meta },
        })
        agent = {} as Agent
        const agentCtx = inner.extend({ agent })
        Object.assign(agent, { id: session.id, session, status: 'idle', ctx: agentCtx })
        await options.setup?.(agentCtx)
        agents.register(agent)
      }, { inject: ['sessions', 'agents'] }))
      return { agent, dispose: () => fiber.dispose() }
    },
    resume: () => Promise.reject(new Error('resume is not used by deletion tests')),
  })
  return ctx
}

const api = (ctx: Context) => createApiProxy(ctx, {
  defaultModelSelection: () => ({ provider: 'p', model: 'm' }),
  cwd: '/tmp',
})

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('sessions.delete', () => {
  it('tears down and deletes an idle blank Session owned by the gateway', async () => {
    const ctx = await composed()
    const gateway = api(ctx)
    const created = await gateway.sessions.create(request({}))
    if (!created.result.ok) throw new Error(created.result.error.message)

    const deleted = await gateway.sessions.delete(request({ sessionId: created.result.value.sessionId }))

    expect(deleted.result).toEqual({
      ok: true,
      value: { deletedSessionIds: [created.result.value.sessionId] },
    })
    expect(ctx.sessions.get(created.result.value.sessionId)).toBeUndefined()
    expect(await ctx.sessionPersistence.list()).toEqual([])
  })

  it('refuses a running Session without tearing down its lifecycle', async () => {
    const ctx = await composed()
    const gateway = api(ctx)
    const created = await gateway.sessions.create(request({}))
    if (!created.result.ok) throw new Error(created.result.error.message)
    const agent = ctx.agents.get(created.result.value.sessionId) as Agent & { status: string }
    agent.status = 'running'

    const refused = await gateway.sessions.delete(request({ sessionId: agent.id }))

    expect(refused.result).toMatchObject({
      ok: false,
      error: { code: 'session-running', details: { sessionId: agent.id } },
    })
    expect(ctx.sessions.get(agent.id)).toBe(agent.session)
  })

  it('requires recursive intent and then deletes descendants before the parent', async () => {
    const ctx = await composed()
    const parent = header('parent')
    const child = header('child', parent.id)
    await ctx.sessionPersistence.create(parent)
    await ctx.sessionPersistence.append(parent.id, log)
    await ctx.sessionPersistence.create(child)
    await ctx.sessionPersistence.append(child.id, log)
    const gateway = api(ctx)

    const refused = await gateway.sessions.delete(request({ sessionId: parent.id }))
    expect(refused.result).toMatchObject({
      ok: false,
      error: { code: 'session-has-children', details: { sessionId: parent.id, childSessionIds: [child.id] } },
    })

    const deleted = await gateway.sessions.delete(request({ sessionId: parent.id, recursive: true }))
    expect(deleted.result).toEqual({
      ok: true,
      value: { deletedSessionIds: [child.id, parent.id] },
    })
    expect(await ctx.sessionPersistence.list()).toEqual([])
  })
})
