import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'
import { apply } from '../src/index.ts'

let ctx: Context | undefined

afterEach(async () => {
  await ctx?.fiber.dispose()
  ctx = undefined
})

describe('ui-turn-edit-resend node plugin', () => {
  it('mounts no Host capability of its own', async () => {
    ctx = new Context()

    await ctx.plugin({ apply }).await()

    // The Host `turnResend` service belongs to the Bundle row; this plugin's
    // node half carries only the browser bundle.
    expect(ctx.get('turnResend')).toBeUndefined()
  })
})
