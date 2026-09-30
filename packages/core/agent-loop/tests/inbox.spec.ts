import { Context } from '@deepseek-ai/cordis'
import { agentEvents, type Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage, freezeMessage } from '@deepseek-ai/dsh-llm'
import SessionStore, { Session, SessionId, SessionSeq } from '@deepseek-ai/dsh-session'
import type { UserMessage } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import { describe, expect, it, onTestFinished } from 'vitest'
import { inboxProjectionDefinition, ReactLoopInbox } from '../src/inbox.ts'

function unsupportedInbox(): Agent['inbox'] {
  const rejectMutation = (): never => {
    throw new Error('this test Agent does not support Inbox mutations')
  }
  return {
    nextTurn: [], nextStep: [], clear: rejectMutation, append: rejectMutation,
    prepend: rejectMutation, replace: rejectMutation, remove: rejectMutation, splice: rejectMutation,
  }
}

function stubAgent(rawId: string, overrides: Partial<Agent> = {}): Agent {
  const id = SessionId(rawId)
  const session = overrides.session ?? Session.create(id)
  const ctx = overrides.ctx ?? new Context()
  return {
    id,
    options: {},
    session,
    inbox: unsupportedInbox(),
    status: 'idle',
    ctx,
    send: () => {},
    followup: () => {},
    steer: () => {},
    inject: () => {},
    cancel() {},
    runMaintenance: task => task(new AbortController().signal),
    whenIdle: () => Promise.resolve(),
    ...overrides,
  }
}

async function inboxAgent(rawId: string): Promise<{
  ctx: Context
  session: Session
  agent: Agent
  inbox: ReactLoopInbox
}> {
  const ctx = new Context()
  onTestFinished(() => ctx.fiber.dispose())
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  ctx.sessionProjections.register(inboxProjectionDefinition)
  const session = ctx.sessions.create(SessionId(rawId))
  const agent = stubAgent(rawId, { ctx, session })
  const inbox = new ReactLoopInbox(ctx.sessionProjections, session, agentEvents(ctx, agent))
  Object.assign(agent, { inbox })
  return { ctx, session, agent, inbox }
}

async function reconstructPersistedInbox(
  rawId: string,
  populate: (session: Session) => void,
): Promise<Error> {
  const ctx = new Context()
  onTestFinished(() => ctx.fiber.dispose())
  await ctx.plugin(SessionStore)
  const session = ctx.sessions.create(SessionId(rawId))
  populate(session)
  await ctx.plugin(SessionProjectionRegistry)
  ctx.sessionProjections.register(inboxProjectionDefinition)
  const agent = stubAgent(rawId, { ctx, session })
  const inbox = new ReactLoopInbox(ctx.sessionProjections, session, agentEvents(ctx, agent))
  try {
    void inbox.nextTurn
  } catch (error: unknown) {
    if (error instanceof Error) return error
    throw error
  }
  throw new Error('persisted inbox reconstruction unexpectedly succeeded')
}

describe('ReactLoopInbox', () => {
  it('reads the shared projection without owning its registration', async () => {
    const ctx = new Context()
    onTestFinished(() => ctx.fiber.dispose())
    await ctx.plugin(SessionStore)
    await ctx.plugin(SessionProjectionRegistry)
    const unregister = ctx.sessionProjections.register(inboxProjectionDefinition)
    const session = ctx.sessions.create(SessionId('inbox-projection'))
    const pending = createUserMessage({
      content: [{ type: 'text', text: 'pending' }],
      source: { kind: 'user' },
    })
    session.append('agent/inbox/spliced', {
      target: 'next-turn', start: 0, inserted: [pending],
    })
    const agent = stubAgent('inbox-projection', { ctx, session })
    const dispatch = agentEvents(ctx, agent)
    const first = new ReactLoopInbox(ctx.sessionProjections, session, dispatch)
    const second = new ReactLoopInbox(ctx.sessionProjections, session, dispatch)

    expect(first.nextTurn).toEqual([pending])
    expect(second.nextTurn).toEqual([pending])
    expect(ctx.sessionProjections.snapshot(session).values.inbox).toEqual({
      'next-turn': [pending],
      'next-step': [],
    })

    unregister()
    expect(ctx.sessionProjections.stateOf(session, 'inbox')).toBeUndefined()
    expect(() => first.nextTurn).toThrow('its projection registration is not active')
  })

  it('rejects invalid durable coordinates and duplicate identities during reconstruction', async () => {
    const outOfRange = await reconstructPersistedInbox('invalid-inbox-range', (session) => {
      session.append('agent/inbox/spliced', {
        target: 'next-turn', start: 0, removedCount: 1, inserted: [],
      })
    })
    expect(outOfRange.message).toBe('invalid persisted inbox splice at session seq 0')
    expect((outOfRange.cause as Error).message).toBe('invalid inbox splice')

    const pending = createUserMessage({
      content: [{ type: 'text', text: 'duplicate' }],
      source: { kind: 'user' },
    })
    const duplicate = await reconstructPersistedInbox('invalid-inbox-duplicate', (session) => {
      session.append('agent/inbox/spliced', {
        target: 'next-turn', start: 0, inserted: [pending],
      })
      session.append('agent/inbox/spliced', {
        target: 'next-step', start: 0, inserted: [pending],
      })
    })
    expect(duplicate.message).toBe('invalid persisted inbox splice at session seq 1')
    expect((duplicate.cause as Error).message).toBe(`message "${pending.id}" is already pending`)
  })

  it('projects inherited inbox events in a forked session', async () => {
    const ctx = new Context()
    onTestFinished(() => ctx.fiber.dispose())
    await ctx.plugin(SessionStore)
    await ctx.plugin(SessionProjectionRegistry)
    ctx.sessionProjections.register(inboxProjectionDefinition)
    const parent = ctx.sessions.create(SessionId('inbox-fork-parent'))
    const parentAgent = stubAgent('inbox-fork-parent', { ctx, session: parent })
    const parentInbox = new ReactLoopInbox(ctx.sessionProjections, parent, agentEvents(ctx, parentAgent))
    const inherited = createUserMessage({
      content: [{ type: 'text', text: 'parent pending' }],
      source: { kind: 'user' },
    })
    parentInbox.append('next-turn', inherited)
    const child = ctx.sessions.fork(parent, undefined, SessionId('inbox-fork-child'))
    const childAgent = stubAgent('inbox-fork-child', { ctx, session: child })
    const childInbox = new ReactLoopInbox(ctx.sessionProjections, child, agentEvents(ctx, childAgent))

    expect(child.inheritedEventCount).toBe(parent.snapshotEvents().length)
    expect(childInbox.nextTurn).toEqual([inherited])

    const own = createUserMessage({
      content: [{ type: 'text', text: 'child pending' }],
      source: { kind: 'user' },
    })
    childInbox.append('next-turn', own)
    expect(childInbox.nextTurn).toEqual([inherited, own])

  })

  it('updates the projection cell before session observers run', async () => {
    const { ctx, session, inbox } = await inboxAgent('inbox-live-projection')
    const pending = createUserMessage({
      content: [{ type: 'text', text: 'direct' }],
      source: { kind: 'user' },
    })
    let observed: readonly UserMessage[] | undefined
    ctx.on('session/event', (subject, event) => {
      if (subject === session && event.type === 'agent/inbox/spliced') {
        observed = ctx.sessionProjections.stateOf(session, 'inbox')?.['next-turn']
      }
    })

    inbox.append('next-turn', pending)

    expect(observed).toEqual([pending])
    expect(ctx.sessionProjections.snapshot(session).values.inbox).toEqual({
      'next-turn': [pending], 'next-step': [],
    })
  })

  it('replaces a pending message by identity across both lists', async () => {
    const { ctx, agent } = await inboxAgent('replace-inbox')
    const inserted: UserMessage[] = []
    const discarded: UserMessage[] = []
    ctx.on('agent/inbox/inserted', ({ message }) => void inserted.push(message))
    ctx.on('agent/inbox/discarded', ({ message }) => void discarded.push(message))
    const original = createUserMessage({
      content: [{ type: 'text', text: 'original' }],
      source: { kind: 'user' },
    })
    const nextStep = createUserMessage({
      content: [{ type: 'text', text: 'step' }],
      source: { kind: 'user' },
    })
    const replacement = createUserMessage({
      content: [{ type: 'text', text: 'replacement' }],
      source: { kind: 'user' },
    })
    const editedStep = freezeMessage({
      ...nextStep,
      content: [{ type: 'text', text: 'edited step' }],
    })
    agent.inbox.append('next-turn', original)
    agent.inbox.append('next-step', nextStep)

    expect(agent.inbox.replace(createUserMessage({
      content: [{ type: 'text', text: 'missing' }],
      source: { kind: 'user' },
    }).id, replacement)).toBe(false)
    expect(agent.inbox.replace(original.id, replacement)).toBe(true)
    expect(agent.inbox.replace(nextStep.id, editedStep)).toBe(true)
    expect(agent.inbox.nextTurn).toEqual([replacement])
    expect(agent.inbox.nextStep).toEqual([editedStep])
    expect(discarded).toEqual([original, nextStep])
    expect(inserted).toEqual([original, nextStep, replacement, editedStep])
    expect(() => { agent.inbox.replace(editedStep.id, replacement) })
      .toThrow(`message "${replacement.id}" is already pending`)
  })

  it('normalizes splice coordinates, rejects duplicate identities, and reports missing removals', async () => {
    const { agent } = await inboxAgent('splice-inbox')
    const first = createUserMessage({
      content: [{ type: 'text', text: 'first' }],
      source: { kind: 'user' },
    })
    const second = createUserMessage({
      content: [{ type: 'text', text: 'second' }],
      source: { kind: 'user' },
    })
    const prefixed = createUserMessage({
      content: [{ type: 'text', text: 'prefixed' }],
      source: { kind: 'user' },
    })

    agent.inbox.splice('next-turn', Number.NaN, Number.NaN, [first, second])
    expect(agent.inbox.nextTurn).toEqual([first, second])
    expect(agent.inbox.splice('next-turn', -1, 1, [])).toEqual([second])
    agent.inbox.prepend('next-turn', prefixed)
    expect(agent.inbox.nextTurn).toEqual([prefixed, first])
    expect(agent.inbox.remove(second.id)).toBe(false)
    expect(() => { agent.inbox.append('next-step', first) }).toThrow(`message "${first.id}" is already pending`)
  })

  it('clears both pending lists as durable cancellations', async () => {
    const { ctx, session, agent } = await inboxAgent('clear-inbox')
    const discarded: UserMessage[] = []
    ctx.on('agent/inbox/discarded', ({ message }) => void discarded.push(message))
    const nextTurn = createUserMessage({ content: [{ type: 'text', text: 'turn' }], source: { kind: 'user' } })
    const nextStep = createUserMessage({ content: [{ type: 'text', text: 'step' }], source: { kind: 'user' } })
    agent.inbox.append('next-turn', nextTurn)
    agent.inbox.append('next-step', nextStep)
    const beforeClear = session.snapshotEvents().length

    agent.inbox.clear()

    expect(agent.inbox.nextTurn).toEqual([])
    expect(agent.inbox.nextStep).toEqual([])
    expect(discarded).toEqual([nextStep, nextTurn])
    expect(session.snapshotEvents().slice(beforeClear).map(event => event.type === 'agent/inbox/spliced'
      ? event.data
      : event.type)).toEqual([
      { target: 'next-step', start: 0, removedCount: 1, inserted: [], outcome: 'canceled' },
      { target: 'next-turn', start: 0, removedCount: 1, inserted: [], outcome: 'canceled' },
    ])

    agent.inbox.clear()
    expect(session.snapshotEvents()).toHaveLength(beforeClear + 2)
  })
})

describe('ReactLoopInbox resend replacements', () => {
  const range = { startSeq: SessionSeq(4), endSeq: SessionSeq(6), sourceEventSeqs: [SessionSeq(4), SessionSeq(5), SessionSeq(6)] }

  it('records a resend range with the splice that queues it', async () => {
    const { ctx, session, agent } = await inboxAgent('resend-splice')
    const resent = createUserMessage({ content: [{ type: 'text', text: 'edited' }], source: { kind: 'user' } })

    agent.inbox.splice('next-turn', Infinity, 0, [resent], { [resent.id]: range })

    expect(ctx.sessionProjections.stateOf(session, 'inbox')?.replacements).toEqual({ [resent.id]: range })
    expect(session.snapshotEvents().at(-1)).toMatchObject({
      type: 'agent/inbox/spliced',
      data: { replacements: { [resent.id]: range } },
    })
  })

  it('refuses a range that names a message the splice did not insert', async () => {
    const { agent } = await inboxAgent('resend-unknown-identity')
    const resent = createUserMessage({ content: [{ type: 'text', text: 'edited' }], source: { kind: 'user' } })
    const other = createUserMessage({ content: [{ type: 'text', text: 'other' }], source: { kind: 'user' } })

    expect(() => { agent.inbox.splice('next-turn', 0, 0, [resent], { [other.id]: range }) })
      .toThrow(`resend "${other.id}" is not an inserted message`)
  })

  it('rejects a persisted splice whose range names an uninserted identity', async () => {
    const pending = createUserMessage({ content: [{ type: 'text', text: 'persisted' }], source: { kind: 'user' } })
    const absent = createUserMessage({ content: [{ type: 'text', text: 'absent' }], source: { kind: 'user' } })
    const error = await reconstructPersistedInbox('resend-persisted-unknown', (session) => {
      session.append('agent/inbox/spliced', {
        target: 'next-turn', start: 0, inserted: [pending],
        replacements: { [absent.id]: range },
      })
    })
    expect(error.message).toBe('invalid persisted inbox splice at session seq 0')
    expect((error.cause as Error).message).toBe(`resend "${absent.id}" is not an inserted message`)
  })

  it('hands the range to the claiming driver and leaves none pending', async () => {
    const { ctx, session, agent, inbox } = await inboxAgent('resend-claim')
    const steering = createUserMessage({ content: [{ type: 'text', text: 'steering' }], source: { kind: 'user' } })
    const resent = createUserMessage({ content: [{ type: 'text', text: 'edited' }], source: { kind: 'user' } })
    agent.inbox.append('next-step', steering)
    agent.inbox.splice('next-turn', Infinity, 0, [resent], { [resent.id]: range })

    const claimed = inbox.claim('next-turn', 1)

    expect(claimed.messages).toEqual([steering, resent])
    expect(claimed.replacements).toEqual({ [resent.id]: range })
    expect(ctx.sessionProjections.stateOf(session, 'inbox')?.replacements).toEqual({})
  })

  it('drops a queued range when its message is canceled or removed', async () => {
    const { ctx, session, agent } = await inboxAgent('resend-cancel')
    const resent = createUserMessage({ content: [{ type: 'text', text: 'edited' }], source: { kind: 'user' } })
    agent.inbox.splice('next-turn', Infinity, 0, [resent], { [resent.id]: range })

    expect(agent.inbox.remove(resent.id)).toBe(true)
    expect(ctx.sessionProjections.stateOf(session, 'inbox')?.replacements).toEqual({})

    agent.inbox.splice('next-turn', Infinity, 0, [resent], { [resent.id]: range })
    agent.inbox.clear()
    expect(ctx.sessionProjections.stateOf(session, 'inbox')?.replacements).toEqual({})
    expect(session.snapshotEvents().map(event => event.type === 'agent/inbox/spliced'
      ? event.data.replacements
      : event.type)).toEqual([
      { [resent.id]: range }, undefined, { [resent.id]: range }, undefined,
    ])
  })

  it('replays a persisted resend range from a log written before the field existed', async () => {
    const { ctx, session, agent } = await inboxAgent('resend-legacy-log')
    const legacy = createUserMessage({ content: [{ type: 'text', text: 'legacy' }], source: { kind: 'user' } })
    session.append('agent/inbox/spliced', { target: 'next-turn', start: 0, inserted: [legacy] })
    const resent = createUserMessage({ content: [{ type: 'text', text: 'edited' }], source: { kind: 'user' } })
    agent.inbox.splice('next-turn', Infinity, 0, [resent], { [resent.id]: range })
    expect(ctx.sessionProjections.stateOf(session, 'inbox')?.replacements).toEqual({ [resent.id]: range })

    expect(legacy.id).toBe((agent.inbox as ReactLoopInbox).claim('next-turn', 1).messages[0]?.id)
    expect((agent.inbox as ReactLoopInbox).claim('next-turn', 2).replacements)
      .toEqual({ [resent.id]: range })
  })
})
