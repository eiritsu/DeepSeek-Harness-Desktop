import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import { apply as applyHost } from '../src/index.ts'
import { apply, inject } from '../src/client/index.ts'
import { ComposerAttachments } from '../src/client/ComposerAttachments.tsx'
import { MessageImages } from '../src/client/MessageImages.tsx'

async function bench() {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const registerSource = vi.fn(() => () => {})
  ctx.provide('inputTriggers', { registerSource } as never)
  ctx.provide('locale', { bind: () => ((key: string) => key) } as never)
  ctx.slots.register({
    name: 'root',
    children: {
      'conversation.input.attachments': { kind: 'single', scope: 'session-maybe' },
      'conversation.message.images': { kind: 'single', scope: 'session' },
    },
  } as never, () => null)
  const fiber = ctx.plugin({ inject: [...inject], apply })
  await fiber.await()
  return { ctx, fiber, registerSource }
}

describe('attachment plugin', () => {
  it('keeps the host half empty', () => {
    expect(() => { applyHost() }).not.toThrow()
  })

  it('registers both entries and removes them with the plugin fiber', async () => {
    const { ctx, fiber, registerSource } = await bench()
    expect(inject).toEqual(['slots', 'inputTriggers', 'locale'])
    expect(ctx.slots.entries('conversation.input.attachments')).toMatchObject([{
      locale: 'conversation',
      component: ComposerAttachments,
    }])
    expect(ctx.slots.entries('conversation.message.images')).toMatchObject([{
      locale: 'conversation',
      component: MessageImages,
    }])
    expect(registerSource).toHaveBeenCalledWith(expect.objectContaining({
      name: 'attachment', launcherOnly: true, order: -100,
    }))

    await fiber.dispose()

    expect(ctx.slots.entries('conversation.input.attachments')).toHaveLength(0)
    expect(ctx.slots.entries('conversation.message.images')).toHaveLength(0)
  })
})
