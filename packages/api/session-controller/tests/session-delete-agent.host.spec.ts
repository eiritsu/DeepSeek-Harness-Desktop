/** Idle Session deletion releases only its owning AgentHandle. */

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import { SessionAlreadyOwnedError, SessionPersistenceNotFoundError } from '@deepseek-ai/dsh-session-persistence'
import { SessionId, SessionLogOffset } from '@deepseek-ai/dsh-session'
import { mountAgentLoopTestDependencies, mountAgentLoopTestHarness } from '@deepseek-ai/dsh-agent-loop-testkit'
import { ApiSessionAgentController } from '../src/agent.ts'
import { SessionCommandController } from '../src/commands.ts'
import { MockAdapter, textResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function host() {
  const root = await mkdtemp(join(tmpdir(), 'dsh-session-delete-agent-'))
  roots.push(root)
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(JsonlSessionPersistence, { root, compression: 'none' })
  const typert = {
    lookups: { configure: () => () => {} },
    contexts: { configureHost: () => () => {} },
  }
  ctx.provide('typert', typert as never)
  const owner = new ApiSessionAgentController(ctx)
  await mountAgentLoopTestHarness(ctx)
  ctx.llm.registerAdapter(['mock'], new MockAdapter([textResponse('done')]))
  return { ctx, owner }
}

describe('Session delete Agent owner', () => {
  it('reproduces idle writer ownership, then deletes after owner-scoped idle close', async () => {
    const { ctx, owner } = await host()
    const id = SessionId('delete-idle-current')
    const agent = await owner.createOwned({ sessionId: id, agentOptions: { provider: 'mock', model: 'mock' } })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'persist this session' }], source: { kind: 'user' } }))
    await agent.whenIdle()

    await expect(ctx.sessionPersistence.delete(id)).rejects.toBeInstanceOf(SessionAlreadyOwnedError)
    const admission = owner.admitDelete(id)
    await admission.close()
    await expect(ctx.sessionPersistence.delete(id)).resolves.toBeUndefined()
    admission.finish(true)
    await expect(ctx.sessionPersistence.open(id, 'read')).rejects.toBeInstanceOf(SessionPersistenceNotFoundError)
    await expect(owner.resolveAgent(id)).resolves.toMatchObject({ error: { code: 'session/not-found' } })
    await ctx.fiber.dispose()
  })

  it('refuses queued work without disposing the Agent', async () => {
    const { ctx, owner } = await host()
    const id = SessionId('delete-busy-current')
    const agent = await owner.createOwned({ sessionId: id, agentOptions: { provider: 'mock', model: 'mock' } })
    agent.inbox.append('next-turn', createUserMessage({
      content: [{ type: 'text', text: 'queued work' }],
      source: { kind: 'user' },
    }))
    const admission = owner.admitDelete(id)
    await expect(admission.close()).rejects.toMatchObject({
      name: 'WorkspaceActiveSessionError',
      activity: [{ kind: 'turn' }],
    })
    expect(ctx.agents.get(id)).toBe(agent)
    expect(agent.inbox.nextTurn.length + agent.inbox.nextStep.length).toBe(1)
    admission.finish(false)
    await ctx.fiber.dispose()
  })

  it('refuses an active maintenance operation without aborting it', async () => {
    const { ctx, owner } = await host()
    const id = SessionId('delete-maintenance-current')
    const agent = await owner.createOwned({ sessionId: id, agentOptions: { provider: 'mock', model: 'mock' } })
    let release!: () => void
    let started!: () => void
    const entered = new Promise<void>((resolve) => { started = resolve })
    const maintenance = agent.runMaintenance(async (signal) => {
      started()
      await new Promise<void>((resolve) => { release = resolve })
      expect(signal.aborted).toBe(false)
    })
    await entered
    const admission = owner.admitDelete(id)
    await expect(admission.close()).rejects.toMatchObject({ name: 'WorkspaceActiveSessionError' })
    admission.finish(false)
    release()
    await maintenance
    expect(ctx.agents.get(id)).toBe(agent)
    await ctx.fiber.dispose()
  })

  it('rejects a prompt that resolved before deletion but had not committed yet', async () => {
    const { ctx, owner } = await host()
    const id = SessionId('delete-prompt-race')
    await owner.createOwned({ sessionId: id, agentOptions: { provider: 'mock', model: 'mock' } })
    let finishContent!: (value: readonly { type: 'text'; text: string }[]) => void
    let entered!: () => void
    const contentEntered = new Promise<void>((resolve) => { entered = resolve })
    ctx.provide('attachments', {
      admitPromptContent: () => {
        entered()
        return new Promise((resolve) => { finishContent = resolve })
      },
    } as never)
    ctx.provide('fileUploads', {
      resolve: () => undefined,
      bindPrompt: () => ({ commit: () => {}, [Symbol.dispose]: () => {} }),
      retirePrompt: () => {},
      registerAgentResolver: () => () => {},
    } as never)
    const commands = new SessionCommandController(ctx, owner, '/tmp')
    const submission = commands.prompt({
      sessionId: id,
      requestId: 'prompt-race' as never,
      content: [{ type: 'text', text: 'must not be acknowledged' }],
      mode: 'followup',
    } as never)
    await contentEntered

    const admission = owner.admitDelete(id)
    await admission.close()
    finishContent([{ type: 'text', text: 'must not be acknowledged' }])
    await expect(submission).rejects.toMatchObject({ code: 'session/agent-busy' })
    admission.finish(false)
    await ctx.fiber.dispose()
  })

  it('releases the admission gate after a failed physical delete so the Session can resume', async () => {
    const { ctx, owner } = await host()
    const id = SessionId('delete-retry-current')
    const agent = await owner.createOwned({ sessionId: id, agentOptions: { provider: 'mock', model: 'mock' } })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'persist this session' }], source: { kind: 'user' } }))
    await agent.whenIdle()
    const admission = owner.admitDelete(id)
    await admission.close()
    admission.finish(false)

    const resumed = await ctx.agents.resume({ resumeSessionId: id, agentOptions: { provider: 'mock', model: 'mock' } })
    expect(resumed.agent.id).toBe(id)
    await resumed.dispose()
    await ctx.fiber.dispose()
  })

  it('deleting a fork parent leaves the child generation readable', async () => {
    const { ctx, owner } = await host()
    const parentId = SessionId('delete-fork-parent')
    const childId = SessionId('delete-fork-child')
    const parent = await owner.createOwned({ sessionId: parentId, agentOptions: { provider: 'mock', model: 'mock' } })
    parent.followup(createUserMessage({ content: [{ type: 'text', text: 'parent' }], source: { kind: 'user' } }))
    await parent.whenIdle()
    const child = await owner.createOwned({
      sessionId: childId,
      agentOptions: { provider: 'mock', model: 'mock' },
      meta: { parentSession: parentId, isSeeded: true },
      seed: parent.session.snapshotEvents(),
      inheritedEventCount: SessionLogOffset(parent.session.snapshotEvents().length),
    })
    child.followup(createUserMessage({ content: [{ type: 'text', text: 'child' }], source: { kind: 'user' } }))
    await child.whenIdle()

    const admission = owner.admitDelete(parentId)
    await admission.close()
    await ctx.sessionPersistence.delete(parentId)
    admission.finish(true)
    const childReader = await ctx.sessionPersistence.open(childId, 'read')
    const childLog = await childReader.read()
    await childReader.close()
    expect((await ctx.sessionPersistence.stat(childId))?.header.parentSession).toBe(parentId)
    expect(childLog.events.some(event => event.type === 'assistant/message')).toBe(true)
    await ctx.fiber.dispose()
  })
})
