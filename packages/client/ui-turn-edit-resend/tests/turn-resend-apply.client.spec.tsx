// @vitest-environment jsdom
/** Plugin wiring: the entry claims the clicked message, the body entry elects on the claim, and disposal releases it. */

import { describe, expect, it } from 'vitest'
import { SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { apply, inject } from '../src/client/index.ts'
import type { TurnResendActionInjected } from '../src/client/TurnResendAction.tsx'
import type { TurnResendBodyInjected, TurnResendBodyMatch } from '../src/client/TurnResendBody.tsx'
import type { TurnResendEdit, TurnResendOutcome } from '../src/client/store.ts'

const SID = 'session-resend' as SessionId

type Check = { ok: true; value: unknown } | { ok: false; error: { code: string } }
/** The slot core erases a session-scoped inject face; each call site restores the members it registered. */
type ErasedInject = (sessionId: SessionId) => Record<string, unknown>

function bench(check: Check) {
  return (async () => {
    const runtime = await SlotTestRuntime.create()
    const locale = new LocaleRuntime(runtime.ctx)
    runtime.ctx.provide('locale', locale)
    runtime.slots.installLocale(locale)
    const claims = new Map<number, string>()
    runtime.ctx.provide('uiChat', {
      claimUserMessageBody: (_sessionId: SessionId, seq: number, owner: string) => {
        claims.set(seq, owner)
        return () => { claims.delete(seq) }
      },
    } as never)
    runtime.remote.provideNamespaces({
      turnResend: { check: async () => check },
    })
    await runtime.root.declare({
      'conversation.chat.user-actions': { kind: 'list', scope: 'session' },
      'conversation.chat.user-body': { kind: 'chain', scope: 'session' },
    }, (_props: { renderSlot?: unknown; renderSlotChain?: unknown }) => null)
    await runtime.mount({ inject: [...inject], apply })
    const action = runtime.slots.entries('conversation.chat.user-actions')
      .find(entry => entry.options.id === 'turn-edit-resend')
    const body = runtime.slots.entries('conversation.chat.user-body')[0]
    if (action?.inject === undefined || body?.inject === undefined) {
      throw new Error('plugin did not register both seats')
    }
    const actionInject = action.inject as ErasedInject
    const bodyInject = body.inject as ErasedInject
    return {
      runtime,
      claims,
      beginEdit: actionInject(SID).beginEdit as TurnResendActionInjected['beginEdit'],
      release: bodyInject(SID).release as TurnResendBodyInjected['release'],
      submit: bodyInject(SID).submit as TurnResendBodyInjected['submit'],
      select: body.select as (owner: { seq: number; claimed: boolean }) => TurnResendBodyMatch | null,
    }
  })()
}

const eligible = {
  ok: true,
  value: { eligible: true, text: 'seed', turn: 1, startSeq: 5, toolCalls: [] },
} as const

describe('edit-and-resend wiring', () => {
  it('claims the clicked message and returns the edit', async () => {
    const { runtime, claims, beginEdit, release } = await bench(eligible)
    try {
      const result = await beginEdit(5)
      expect(result).toMatchObject({ kind: 'edit', edit: { startSeq: 5, text: 'seed' } })
      expect([...claims.keys()]).toEqual([5])

      release()
      expect(claims.size).toBe(0)
    } finally {
      await runtime.dispose()
    }
  })

  it('declines a click whose seq is not the Host target', async () => {
    const { runtime, claims, beginEdit } = await bench(eligible)
    try {
      expect(await beginEdit(9)).toEqual({ kind: 'none' })
      expect(claims.size).toBe(0)
    } finally {
      await runtime.dispose()
    }
  })

  it('claims the clicked message for a refusal and a transport failure', async () => {
    for (const check of [
      { ok: true, value: { eligible: false, refusal: 'no-replaceable-turn' } },
      { ok: false, error: { code: 'session/writer-held' } },
    ] satisfies Check[]) {
      const { runtime, claims, beginEdit } = await bench(check)
      try {
        const result = await beginEdit(5)
        expect(result.kind).toBe('notice')
        expect([...claims.keys()]).toEqual([5])
      } finally {
        await runtime.dispose()
      }
    }
  })

  it('maps every submission result to its outcome', async () => {
    const cases: readonly [unknown, unknown][] = [
      [{ ok: true, value: { recorded: true, operation: { outcome: 'admitted' } } }, undefined],
      [{ ok: true, value: { recorded: true, operation: { outcome: 'refused', refusal: 'agent-busy' } } }, { kind: 'refused', refusal: 'agent-busy' }],
      [{ ok: true, value: { recorded: true, operation: { outcome: 'failed', reason: 'disk full' } } }, { kind: 'failed', reason: 'disk full' }],
      [{ ok: true, value: { recorded: true, operation: { outcome: 'pending' } } }, { kind: 'pending' }],
      [{ ok: true, value: { recorded: true, operation: { outcome: 'uncertain' } } }, { kind: 'uncertain' }],
      [{ ok: true, value: { recorded: false, refusal: 'no-replaceable-turn' } }, { kind: 'not-admitted' }],
      [{ ok: false, error: { code: 'gateway/internal' } }, { kind: 'remote-failed', code: 'gateway/internal' }],
    ]
    for (const [result, expected] of cases) {
      const runtime = await SlotTestRuntime.create()
      const locale = new LocaleRuntime(runtime.ctx)
      runtime.ctx.provide('locale', locale)
      runtime.slots.installLocale(locale)
      runtime.ctx.provide('uiChat', { claimUserMessageBody: () => () => {} } as never)
      runtime.remote.provideNamespaces({ turnResend: { check: async () => eligible, submit: async () => result } })
      await runtime.root.declare({
        'conversation.chat.user-actions': { kind: 'list', scope: 'session' },
        'conversation.chat.user-body': { kind: 'chain', scope: 'session' },
      }, (_props: { renderSlot?: unknown; renderSlotChain?: unknown }) => null)
      await runtime.mount({ inject: [...inject], apply })
      const body = runtime.slots.entries('conversation.chat.user-body')[0]
      if (body?.inject === undefined) throw new Error('plugin did not register the body seat')
      const submit = (body.inject as ErasedInject)(SID).submit as TurnResendBodyInjected['submit']
      const edit: TurnResendEdit = { sessionId: SID, operationId: 'op', turn: 1, startSeq: 5, text: 'x', toolCalls: [] }
      const outcome: TurnResendOutcome | undefined = await submit(edit)
      expect(outcome).toEqual(expected)
      await runtime.dispose()
    }
  })

  it('elects the body entry only for a claimed message', async () => {
    const { runtime, select } = await bench(eligible)
    try {
      expect(select({ seq: 5, claimed: false })).toBeNull()
      expect(select({ seq: 5, claimed: true })).toEqual({ seq: 5 })
    } finally {
      await runtime.dispose()
    }
  })

  it('releases every claim when the plugin unloads', async () => {
    const { runtime, claims, beginEdit } = await bench(eligible)
    await beginEdit(5)
    expect(claims.size).toBe(1)
    await runtime.dispose()
    expect(claims.size).toBe(0)
  })
})
