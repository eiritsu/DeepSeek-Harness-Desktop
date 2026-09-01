// @vitest-environment jsdom

import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { apply as applyHost } from '../src/index.ts'
import { apply, inject } from '../src/client/index.ts'
import { ComposerAttachments } from '../src/client/ComposerAttachments.tsx'
import { MessageImages } from '../src/client/MessageImages.tsx'
import type { InputTriggerSource } from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import { ATTACHMENT_PICKER_EVENT } from '../src/client/picker-event.ts'

async function bench() {
  const ctx = new Context()
  ctx.provide('locale', new LocaleRuntime(ctx))
  let source: InputTriggerSource | undefined
  ctx.provide('inputTriggers', { registerSource: (candidate: InputTriggerSource) => { source = candidate; return () => {} } })
  await ctx.plugin(SlotRegistry).await()
  ctx.slots.register({
    name: 'root',
    children: {
      'conversation.input.attachments': { kind: 'single', scope: 'session-maybe' },
      'conversation.message.images': { kind: 'single', scope: 'session' },
      'conversation.trajectory.images': { kind: 'single', scope: 'session' },
    },
  } as never, () => null)
  const fiber = ctx.plugin({ inject: [...inject], apply })
  await fiber.await()
  return { ctx, fiber, getSource: () => source }
}

describe('attachment plugin', () => {
  it('keeps the host half empty', () => {
    expect(() => { applyHost() }).not.toThrow()
  })

  it('registers all entries and removes them with the plugin fiber', async () => {
    const { ctx, fiber, getSource } = await bench()
    expect(inject).toEqual(['slots', 'inputTriggers', 'locale'])
    const source = getSource()
    expect(source).toMatchObject({ trigger: '/', name: 'attachment', order: -100 })
    expect(await source?.candidates({ sessionId: 'session-1' as never }, {
      query: '', position: 'leading', drilled: false, signal: new AbortController().signal,
    })).toMatchObject([
      { name: 'attachment.filesAndFolders', icon: 'paperclip', value: 'files' },
    ])
    const picker = new Promise<unknown>((resolve) => {
      window.addEventListener(ATTACHMENT_PICKER_EVENT, event => resolve((event as CustomEvent).detail), { once: true })
    })
    expect(source?.onPick({
      candidate: { name: 'attachment.filesAndFolders', value: 'files' },
      session: { sessionId: 'session-1' as never }, position: 'leading', via: 'menu', action: 'pick',
      span: { start: 0, end: 0, draftRev: 0 },
    })).toBe('handled')
    await expect(picker).resolves.toEqual({ kind: 'files' })
    expect(ctx.slots.entries('conversation.input.attachments')).toMatchObject([{
      locale: 'conversation',
      component: ComposerAttachments,
    }])
    expect(ctx.slots.entries('conversation.message.images')).toMatchObject([{
      locale: 'conversation',
      component: MessageImages,
    }])
    expect(ctx.slots.entries('conversation.trajectory.images')).toMatchObject([{
      locale: 'conversation',
      component: MessageImages,
    }])

    await fiber.dispose()

    expect(ctx.slots.entries('conversation.input.attachments')).toHaveLength(0)
    expect(ctx.slots.entries('conversation.message.images')).toHaveLength(0)
    expect(ctx.slots.entries('conversation.trajectory.images')).toHaveLength(0)
  })
})
